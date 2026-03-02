#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${FIGMA_API_BASE_URL:-https://api.figma.com}"
TOKEN="${FIGMA_TOKEN:-}"

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
  local tmp_body
  local status_code
  local curl_exit=0
  local cause=""
  local raw_body=""

  if [[ -n "$query" ]]; then
    url="${url}?${query}"
  fi

  tmp_body="$(mktemp)"

  status_code="$(
    curl -sS \
      -o "$tmp_body" \
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
    rm -f "$tmp_body"
    exit 1
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
    rm -f "$tmp_body"
    exit 1
  fi

  if command -v jq >/dev/null 2>&1; then
    jq . "$tmp_body"
  else
    cat "$tmp_body"
  fi
  rm -f "$tmp_body"
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
