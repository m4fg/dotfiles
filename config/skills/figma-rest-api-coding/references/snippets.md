# Snippets

Use these snippets as templates for coding tasks.

Route API calls through `scripts/figma-api.sh` — it adds file caching and
rate-limit handling that raw `curl` does not have.

## figma-api.sh: get specific nodes (cached)

```bash
scripts/figma-api.sh nodes "${FILE_KEY}" "${NODE_IDS}" "depth=2"
```

## figma-api.sh: export reference PNG (cached)

```bash
scripts/figma-api.sh images "${FILE_KEY}" "${NODE_IDS}" png 2
```

## figma-api.sh: refresh after the design changed

```bash
FIGMA_NO_CACHE=1 scripts/figma-api.sh nodes "${FILE_KEY}" "${NODE_IDS}" "depth=2"
```

## Handling exit code 29 (rate limited)

```bash
status=0
scripts/figma-api.sh nodes "${FILE_KEY}" "${NODE_IDS}" || status=$?
if [[ "$status" -eq 29 ]]; then
  # stderr contained: RATE_LIMITED retry_after=<seconds>
  # STOP all Figma API calls, wait that long, then re-run this command.
  exit 29
elif [[ "$status" -ne 0 ]]; then
  exit "$status"
fi
```

## curl: debug only (bypasses cache and rate-limit gate)

```bash
curl -sS --fail-with-body \
  -H "X-Figma-Token: ${FIGMA_TOKEN}" \
  "https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${NODE_IDS}&depth=2"
```

## TypeScript: stop-all-on-429 request helper

On `429`, throw and stop the whole pipeline — do not auto-retry inside the
helper while other requests keep firing. The caller waits `retryAfterSec`,
then resumes from the failed request.

```ts
class RateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Figma rate limit hit. Stop all requests, wait ${retryAfterSec}s, then resume.`);
  }
}

let blockedUntilMs = 0; // shared gate for ALL Figma requests in this process

async function figmaGet(path: string): Promise<unknown> {
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error("FIGMA_TOKEN is required");

  const waitMs = blockedUntilMs - Date.now();
  if (waitMs > 0) throw new RateLimitError(Math.ceil(waitMs / 1000));

  const res = await fetch(`https://api.figma.com${path}`, {
    headers: { "X-Figma-Token": token },
  });
  if (res.ok) return res.json();

  if (res.status === 429) {
    const headerVal = Number(res.headers.get("retry-after"));
    const retryAfter = Number.isInteger(headerVal) && headerVal > 0 ? headerVal : 60;
    blockedUntilMs = Date.now() + retryAfter * 1000;
    throw new RateLimitError(retryAfter);
  }
  throw new Error(`Figma API failed: ${res.status} ${await res.text()}`);
}
```

## node-id normalization helper

```ts
function normalizeNodeId(input: string): string {
  return input.replace(/-/g, ":");
}
```
