---
name: figma-rest-api-coding
description: "Primary skill for Figma URL/node-id tasks. Use this first when a user provides a Figma URL/node-id. Use Figma for coding workflows: extract file/node JSON, export node images, resolve variables/styles/components/dev resources, and convert design data into implementation-ready code plans. Trigger when a user asks to implement UI from Figma, inspect Figma JSON, or work without Figma MCP."
---

# Figma REST API Coding

Extract implementation-ready data from Figma REST API.

## Trigger Priority (Must Read)

Use this skill FIRST when any of the following is true:

- User provides a `figma.com/design/...` URL (with or without `node-id`)
- The task needs exact node JSON / variables / styles from API
- MCP access is unknown, unstable, or previously failed
- File-access errors are likely (`403`, `404`, permission issues)

## FIGMA_TOKEN Required

This skill REQUIRES a valid `FIGMA_TOKEN` with appropriate scopes.
To load the token, ensure it is set in the environment variable `FIGMA_TOKEN` before invoking this skill. For example:
source ~/figma.conf

If the token is missing or invalid, report an authentication error and do not attempt API calls.

## Load References

Load only the relevant reference files:

- `references/coding-endpoints.md` when selecting endpoints, scopes, and limits
- `references/implementation-workflow.md` when converting design data to code
- `references/snippets.md` when building curl/TypeScript calls quickly

Route ALL Figma API calls through the helper script:

- `scripts/figma-api.sh` — it provides the file cache and rate-limit handling below; raw `curl` bypasses both and is debug-only

## Collect Inputs

Collect the minimum required inputs before calling the API:

- Figma file URL or `file_key`
- Node IDs (optional but strongly recommended)
- Target stack (`HTML/CSS`, `React`, `Vue`, etc.)
- Fidelity target (pixel-perfect or pragmatic)

If a node ID comes from URL format (`1-2`), normalize to API format (`1:2`).

## Authenticate

Set PAT in `FIGMA_TOKEN`.

Use this header:

- `X-Figma-Token: <token>`

Prefer granular scopes. Avoid deprecated broad scopes.

## Execute Minimal-Data Flow

Use this order by default:

1. Call `GET /v1/files/:key/nodes` for target nodes (`ids` + `depth`)
2. Call `GET /v1/images/:key` for visual verification PNG/SVG
3. Call `GET /v1/files/:file_key/variables/local` for design tokens
4. Call file-level `components`, `component_sets`, and `styles` endpoints when mapping to UI components
5. Call `GET /v1/files/:key/versions` only when diffing versions is required

Avoid pulling whole-file payloads unless needed.

## Rate Limit Handling (Must Follow)

The Figma REST API enforces per-endpoint rate limits. When a request hits the limit:

- `scripts/figma-api.sh` exits with code `29` (reserved exclusively for rate limiting — no other failure mode uses it) and prints one machine-readable line to stderr: `RATE_LIMITED retry_after=<seconds>`
- On exit code `29` or any HTTP `429`, IMMEDIATELY STOP ALL further Figma API calls — not just the failed one. Do not fire any remaining planned requests, and do not retry with backoff-and-continue.
- Record which request failed so processing can resume from it later
- Report to the user that the rate limit was hit and how many seconds to wait (`retry_after`; the script defaults to `60` when the API omits `Retry-After`)
- Wait at least `retry_after` seconds before the next API call (split long waits into repeated short sleeps to stay within tool timeouts; if `sleep` is unavailable in the environment, report the wait time to the user and resume on the next turn)
- After waiting, resume from the failed request. If it returns `429` again, stop and wait again — never busy-retry.
- The script records the block window in a shared `rate-limited-until` state file; any script call during the window exits `29` without touching the network. Cache hits still work while rate-limited, so cached data can be used to continue non-API work.

## File Cache (Reduce Request Count)

`scripts/figma-api.sh` caches every successful GET response on disk so repeat requests never hit the API:

- Location: `FIGMA_CACHE_DIR` (default `./temp/figma-cache`), namespaced by a fingerprint of API base URL + token so different accounts never share entries
- TTL: `FIGMA_CACHE_TTL` seconds (default `3600`)
- Refresh: `FIGMA_NO_CACHE=1` ignores the cached copy, fetches fresh, and updates the cache — use it right after the design changed in Figma
- Only `2xx` responses are cached; errors and `429` are never cached
- A cache hit prints `CACHE_HIT <request>` to stderr and makes no network call

To keep request counts low:

- Before re-fetching the same nodes/variables/styles within a task, rely on the cache instead of calling the API again
- Batch node IDs into one `nodes` call (`ids=1:2,3:4`) instead of one call per node
- Fetch only what the task needs (`ids` + `depth`), never the whole file by default

## Convert to Code Plan

Convert API results into implementation artifacts:

- Layout tree: frame hierarchy, auto-layout direction, gap, padding, constraints
- Style map: typography, color, effects, radii, stroke, opacity
- Token map: variable alias chain, fallback values, mode-specific values
- Asset map: export URLs and output file naming
- Component map: instance to implementation component names and props

Then generate code in small increments and verify with exported images.

## Reliability Rules

Apply these rules for stable automation:

- On `429` (or script exit `29`), stop ALL Figma API calls immediately and follow the Rate Limit Handling section — no backoff-and-continue
- Retry transient `5xx` responses
- Chunk very large `ids` queries
- Use the file cache (see File Cache section) so `nodes`, `variables`, `styles` are fetched at most once per TTL
- Report unknown node types explicitly instead of guessing
- If a Figma API request fails, stop processing immediately and report both the error code and cause

## Output Contract

Return structured output with:

1. API calls made (endpoint + purpose)
2. Extracted layout/style/token findings
3. Component mapping decisions
4. Generated code plan (or code patch)
5. Validation notes and unresolved gaps
