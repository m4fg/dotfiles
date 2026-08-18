#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${FIGMA_API_BASE_URL:-https://api.figma.com}"
TOKEN="${FIGMA_TOKEN:-}"
CACHE_ROOT="${FIGMA_CACHE_DIR:-./temp/figma-cache}"
CACHE_TTL="${FIGMA_CACHE_TTL:-3600}"
NO_CACHE="${FIGMA_NO_CACHE:-0}"

RATE_LIMIT_EXIT=29
DEFAULT_RETRY_AFTER=60

if ! [[ "$CACHE_TTL" =~ ^[0-9]+$ ]]; then
  CACHE_TTL=3600
fi

usage() {
  cat <<'USAGE'
Usage:
  figma-api.sh parse-url <figma-url>
  figma-api.sh request <path> [query]
  figma-api.sh nodes <file_key> <node_ids> [extra_query]
  figma-api.sh images <file_key> <node_ids> [format] [scale]
  figma-api.sh variables-local <file_key>
  figma-api.sh components <file_key>
  figma-api.sh component-sets <file_key>
  figma-api.sh styles <file_key>
  figma-api.sh dev-resources <file_key>

Environment:
  FIGMA_TOKEN (PAT, required for API calls)
  FIGMA_API_BASE_URL (optional, default: https://api.figma.com)
  FIGMA_CACHE_DIR (optional, default: ./temp/figma-cache)
  FIGMA_CACHE_TTL (optional, seconds, default: 3600)
  FIGMA_NO_CACHE=1 (optional, ignore cached copy, fetch fresh, update cache)

Exit codes:
  0   success (from network or cache)
  1   generic error (auth, HTTP error, network failure, bad usage)
  29  rate limited (HTTP 429, or a prior 429 window is still active).
      stderr contains a single machine-readable line:
        RATE_LIMITED retry_after=<seconds>
      Stop ALL Figma API calls, wait that many seconds, then resume.

Caching:
  Successful (2xx) GET responses are cached under FIGMA_CACHE_DIR,
  namespaced by a fingerprint of API base URL + token so different
  accounts never share entries. Cache hits print "CACHE_HIT <request>"
  to stderr and make no network call. Errors and 429 are never cached.

Examples:
  figma-api.sh parse-url "https://www.figma.com/design/FILE_KEY/Name?node-id=1-2"
  figma-api.sh nodes FILE_KEY "1:2,3:4" "depth=2"
  figma-api.sh images FILE_KEY "1:2" png 2
USAGE
}

require_token() {
  if [[ -z "$TOKEN" ]]; then
    echo "FIGMA_TOKEN is required." >&2
    exit 1
  fi
}

normalize_node_ids() {
  local raw="$1"
  echo "$raw" | tr '-' ':'
}

sha256_hex() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    echo "sha256 tool not found (need shasum or sha256sum)." >&2
    exit 1
  fi
}

cache_ns_dir() {
  local ns
  ns="$(sha256_hex "${API_BASE_URL}|${TOKEN}" | cut -c1-16)"
  echo "${CACHE_ROOT}/${ns}"
}

emit_body() {
  local file="$1"
  if command -v jq >/dev/null 2>&1; then
    jq . "$file"
  else
    cat "$file"
  fi
}

parse_url() {
  local url="$1"
  local file_key
  local node_id

  file_key="$(echo "$url" | sed -nE 's#https?://(www\.)?figma\.com/(design|file)/([^/?]+).*#\3#p')"
  node_id="$(echo "$url" | sed -nE 's#.*[?&]node-id=([^&]+).*#\1#p')"

  if [[ -n "$node_id" ]]; then
    node_id="$(normalize_node_ids "$node_id")"
  fi

  if [[ -z "$file_key" ]]; then
    echo "Could not parse file key from URL: $url" >&2
    exit 1
  fi

  if [[ -n "$node_id" ]]; then
    printf '{\n  "file_key": "%s",\n  "node_id": "%s"\n}\n' \
      "$file_key" \
      "$node_id"
  else
    printf '{\n  "file_key": "%s",\n  "node_id": null\n}\n' \
      "$file_key"
  fi
}

figma_get() {
  local path="$1"
  local query="${2:-}"
  local url="${API_BASE_URL}${path}"
  local request_id="${path}?${query}"
  local tmp_body
  local tmp_headers
  local status_code
  local curl_exit=0
  local cause=""
  local raw_body=""
  local ns_dir cache_key body_cache ts_cache limit_file now

  if [[ -n "$query" ]]; then
    url="${url}?${query}"
  fi

  ns_dir="$(cache_ns_dir)"
  mkdir -p "$ns_dir"
  chmod 700 "$CACHE_ROOT" "$ns_dir" 2>/dev/null || true

  cache_key="$(sha256_hex "$request_id")"
  body_cache="${ns_dir}/${cache_key}.json"
  ts_cache="${ns_dir}/${cache_key}.ts"
  limit_file="${ns_dir}/rate-limited-until"
  now="$(date +%s)"

  # Cache read: serve a fresh-enough cached response without any network call.
  if [[ "$NO_CACHE" != "1" && -s "$body_cache" && -f "$ts_cache" ]]; then
    local cached_at age
    cached_at="$(cat "$ts_cache" 2>/dev/null || echo 0)"
    if [[ "$cached_at" =~ ^[0-9]+$ ]]; then
      age=$(( now - cached_at ))
      if (( age >= 0 && age < CACHE_TTL )); then
        echo "CACHE_HIT ${request_id}" >&2
        emit_body "$body_cache"
        return 0
      fi
    fi
  fi

  # Shared rate-limit gate: a prior 429 blocks ALL network calls until it expires.
  if [[ -f "$limit_file" ]]; then
    local until_ts
    until_ts="$(cat "$limit_file" 2>/dev/null || echo 0)"
    if [[ "$until_ts" =~ ^[0-9]+$ ]] && (( now < until_ts )); then
      local remaining=$(( until_ts - now ))
      echo "RATE_LIMITED retry_after=${remaining}" >&2
      echo "Figma API is rate-limited from a previous 429. Stop ALL Figma API calls, wait ${remaining}s, then resume. Cached reads are still allowed." >&2
      exit "$RATE_LIMIT_EXIT"
    fi
    rm -f "$limit_file"
  fi

  tmp_body="$(mktemp)"
  tmp_headers="$(mktemp)"

  status_code="$(
    curl -sS \
      -o "$tmp_body" \
      -D "$tmp_headers" \
      -w "%{http_code}" \
      -H "X-Figma-Token: ${TOKEN}" \
      "$url"
  )" || curl_exit=$?

  if [[ "$curl_exit" -ne 0 ]]; then
    echo "Figma API request failed before receiving a valid response." >&2
    echo "Error code: curl_exit_${curl_exit}" >&2
    echo "Cause: network error, timeout, or TLS/DNS issue while requesting ${url}" >&2
    if [[ -s "$tmp_body" ]]; then
      raw_body="$(tr '\n' ' ' < "$tmp_body" | sed 's/[[:space:]]\\+/ /g')"
      if [[ -n "$raw_body" ]]; then
        echo "Response body: ${raw_body}" >&2
      fi
    fi
    rm -f "$tmp_body" "$tmp_headers"
    exit 1
  fi

  if [[ "$status_code" -eq 429 ]]; then
    local retry_after
    retry_after="$(grep -i '^retry-after:' "$tmp_headers" | tail -n 1 | cut -d: -f2- | tr -d '\r' | tr -d '[:space:]' || true)"
    if ! [[ "$retry_after" =~ ^[0-9]+$ ]]; then
      retry_after="$DEFAULT_RETRY_AFTER"
    fi
    printf '%s\n' "$(( now + retry_after ))" > "${limit_file}.tmp.$$"
    mv "${limit_file}.tmp.$$" "$limit_file"
    echo "RATE_LIMITED retry_after=${retry_after}" >&2
    echo "Figma API rate limit reached (HTTP 429). Stop ALL Figma API calls now, wait ${retry_after}s, then resume from this request." >&2
    echo "URL: ${url}" >&2
    rm -f "$tmp_body" "$tmp_headers"
    exit "$RATE_LIMIT_EXIT"
  fi

  if [[ "$status_code" -lt 200 || "$status_code" -ge 300 ]]; then
    if command -v jq >/dev/null 2>&1; then
      cause="$(jq -r 'if type=="object" then (.err // .message // .error // empty) else empty end' "$tmp_body" 2>/dev/null || true)"
    fi
    if [[ -z "$cause" ]]; then
      raw_body="$(tr '\n' ' ' < "$tmp_body" | sed 's/[[:space:]]\\+/ /g')"
      if [[ ${#raw_body} -gt 800 ]]; then
        raw_body="${raw_body:0:800}..."
      fi
      cause="${raw_body:-No detail returned by API.}"
    fi

    echo "Figma API request failed." >&2
    echo "Error code: HTTP_${status_code}" >&2
    echo "Cause: ${cause}" >&2
    echo "URL: ${url}" >&2
    rm -f "$tmp_body" "$tmp_headers"
    exit 1
  fi

  # Success: clear any expired rate-limit marker and cache the raw body
  # atomically (body first, timestamp last, so a readable timestamp implies
  # a complete body).
  rm -f "$limit_file"
  cp "$tmp_body" "${body_cache}.tmp.$$"
  mv "${body_cache}.tmp.$$" "$body_cache"
  printf '%s\n' "$now" > "${ts_cache}.tmp.$$"
  mv "${ts_cache}.tmp.$$" "$ts_cache"
  rm -f "$tmp_body" "$tmp_headers"

  emit_body "$body_cache"
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  local cmd="$1"
  shift

  case "$cmd" in
    -h|--help)
      usage
      ;;
    parse-url)
      if [[ $# -ne 1 ]]; then
        usage
        exit 1
      fi
      parse_url "$1"
      ;;
    request)
      require_token
      if [[ $# -lt 1 || $# -gt 2 ]]; then
        usage
        exit 1
      fi
      figma_get "$1" "${2:-}"
      ;;
    nodes)
      require_token
      if [[ $# -lt 2 || $# -gt 3 ]]; then
        usage
        exit 1
      fi
      local file_key="$1"
      local node_ids
      node_ids="$(normalize_node_ids "$2")"
      local query="ids=${node_ids}"
      if [[ -n "${3:-}" ]]; then
        query="${query}&${3}"
      fi
      figma_get "/v1/files/${file_key}/nodes" "$query"
      ;;
    images)
      require_token
      if [[ $# -lt 2 || $# -gt 4 ]]; then
        usage
        exit 1
      fi
      local file_key="$1"
      local node_ids
      node_ids="$(normalize_node_ids "$2")"
      local format="${3:-png}"
      local scale="${4:-2}"
      figma_get "/v1/images/${file_key}" "ids=${node_ids}&format=${format}&scale=${scale}"
      ;;
    variables-local)
      require_token
      if [[ $# -ne 1 ]]; then
        usage
        exit 1
      fi
      figma_get "/v1/files/$1/variables/local"
      ;;
    components)
      require_token
      if [[ $# -ne 1 ]]; then
        usage
        exit 1
      fi
      figma_get "/v1/files/$1/components"
      ;;
    component-sets)
      require_token
      if [[ $# -ne 1 ]]; then
        usage
        exit 1
      fi
      figma_get "/v1/files/$1/component_sets"
      ;;
    styles)
      require_token
      if [[ $# -ne 1 ]]; then
        usage
        exit 1
      fi
      figma_get "/v1/files/$1/styles"
      ;;
    dev-resources)
      require_token
      if [[ $# -ne 1 ]]; then
        usage
        exit 1
      fi
      figma_get "/v1/files/$1/dev_resources"
      ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
