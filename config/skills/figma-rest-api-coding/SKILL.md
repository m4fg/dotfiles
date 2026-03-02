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
source ~/.env

If the token is missing or invalid, report an authentication error and do not attempt API calls.

## Load References

Load only the relevant reference files:

- `references/coding-endpoints.md` when selecting endpoints, scopes, and limits
- `references/implementation-workflow.md` when converting design data to code
- `references/snippets.md` when building curl/TypeScript calls quickly

Use helper script when useful:

- `scripts/figma-api.sh` for repeatable API calls from terminal

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

- Handle `429` with `Retry-After` and exponential backoff
- Retry transient `5xx` responses
- Chunk very large `ids` queries
- Cache per-run responses for `nodes`, `variables`, `styles`
- Report unknown node types explicitly instead of guessing
- If a Figma API request fails, stop processing immediately and report both the error code and cause

## Output Contract

Return structured output with:

1. API calls made (endpoint + purpose)
2. Extracted layout/style/token findings
3. Component mapping decisions
4. Generated code plan (or code patch)
5. Validation notes and unresolved gaps
