# Implementation Workflow

Follow this workflow to convert Figma REST API data into code.

## 1. Normalize Inputs

1. Extract `file_key` from URL.
2. Extract `node-id` query value if available.
3. Normalize node IDs from `-` to `:`.
4. Decide target stack and fidelity level.

## 2. Build Fetch Plan

Choose the smallest request set that satisfies the task:

1. Required nodes: `GET /v1/files/:key/nodes`
2. Visual references: `GET /v1/images/:key`
3. Tokens: `GET /v1/files/:file_key/variables/local`
4. Component metadata: file-level components, component sets, styles
5. Revision diff (optional): versions endpoint

## 3. Extract Layout Model

From node JSON, extract:

- Parent-child tree
- Auto layout direction and wrapping
- Item spacing and padding
- Sizing mode (`FIXED`, `HUG`, `FILL`)
- Constraint behavior for absolute layouts

Map these to framework primitives before writing code.

## 4. Extract Visual Model

Extract and normalize:

- Color fills and gradients
- Stroke width/color/alignment
- Corner radius (uniform or per-corner)
- Typography (`family`, `size`, `lineHeight`, `letterSpacing`, `weight`)
- Opacity and blend mode
- Effects (`drop-shadow`, `blur`)

Prefer token references over hardcoded values when variables exist.

## 5. Resolve Variables and Styles

1. Build variable map by collection and mode.
2. Resolve aliases recursively.
3. Generate final token names for codebase conventions.
4. Emit fallback value if unresolved alias exists.

## 6. Map Components

For instances and variants:

1. Resolve source component key.
2. Map variant properties to component props.
3. Record unsupported properties explicitly.

Avoid guessing component behavior that is not present in API data.

## 7. Implement in Small Batches

1. Generate structure first (layout only).
2. Apply typography and color tokens.
3. Add effects and responsive behavior.
4. Compare against rendered reference images.
5. Iterate until differences are acceptable for the requested fidelity.

## 8. Handle Errors Predictably

- On any Figma communication error, stop processing immediately and report both error code and cause
- On `429`: back off using `Retry-After`.
- On `403`: check missing scope.
- On `404`: validate `file_key` or node existence.
- On partial data: log missing fields and continue with explicit assumptions.
