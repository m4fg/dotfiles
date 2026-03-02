# Coding Endpoints

Use the following Figma REST endpoints for coding workflows.

## Authentication and Scope

- Use `FIGMA_TOKEN` (PAT)
- Send `X-Figma-Token: <token>`
- Prefer granular scopes such as:
  - `file_content:read`
  - `file_variables:read`
  - `file_dev_resources:read`
  - `library_content:read`
  - `current_user:read`
- Deprecated scopes: `files:read`, `file_variables:write`, `file_dev_resources:write`

## Core Endpoints for UI Implementation

| Endpoint | Primary coding use | Typical scope |
| --- | --- | --- |
| `GET /v1/files/:key` | Get whole-file document tree and metadata | `file_content:read` |
| `GET /v1/files/:key/nodes` | Pull specific nodes only (`ids`, `depth`) | `file_content:read` |
| `GET /v1/images/:key` | Render node images for visual diff/QA | `file_content:read` |
| `GET /v1/files/:key/images` | Resolve image fills referenced by nodes | `file_content:read` |
| `GET /v1/files/:key/meta` | Read metadata such as branch/context info | `file_content:read` |
| `GET /v1/files/:key/versions` | Compare design revisions | `file_content:read` |

## Design System Endpoints

| Endpoint | Primary coding use | Typical scope |
| --- | --- | --- |
| `GET /v1/files/:file_key/components` | Map components to frontend components | `file_content:read` |
| `GET /v1/files/:file_key/component_sets` | Resolve variant structure and options | `file_content:read` |
| `GET /v1/files/:file_key/styles` | Build style token mapping | `file_content:read` |
| `GET /v1/styles/:key` | Inspect a specific published style | `library_content:read` |
| `GET /v1/files/:file_key/variables/local` | Export local variables as tokens | `file_variables:read` |
| `GET /v1/files/:file_key/variables/published` | Inspect published variables by library key | `library_content:read` |

## Dev Resource Endpoints

| Endpoint | Primary coding use | Typical scope |
| --- | --- | --- |
| `GET /v1/files/:file_key/dev_resources` | Read links between nodes and code/docs | `file_dev_resources:read` |
| `POST /v1/files/:file_key/dev_resources` | Attach code reference URLs to nodes | `file_dev_resources:write` |
| `DELETE /v1/files/:file_key/dev_resources/:dev_resource_id` | Remove stale code references | `file_dev_resources:write` |

## Operational Notes

- Convert URL node ID (`1-2`) to API node ID (`1:2`).
- Exported image URLs are temporary. Download immediately for deterministic pipelines.
- Large files can return large payloads. Prefer `nodes` endpoint with targeted `ids`.
- As of November 17, 2025, Figma provides endpoint-specific rate-limit tiers. Handle `429` with backoff.
