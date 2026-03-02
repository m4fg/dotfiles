# Snippets

Use these snippets as templates for coding tasks.

## curl: get specific nodes

```bash
curl -sS --fail-with-body \
  -H "X-Figma-Token: ${FIGMA_TOKEN}" \
  "https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${NODE_IDS}&depth=2"
```

## curl: export reference PNG

```bash
curl -sS --fail-with-body \
  -H "X-Figma-Token: ${FIGMA_TOKEN}" \
  "https://api.figma.com/v1/images/${FILE_KEY}?ids=${NODE_IDS}&format=png&scale=2"
```

## TypeScript: request with retry for 429/5xx

```ts
async function figmaGet(path: string, retries = 4): Promise<unknown> {
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error("FIGMA_TOKEN is required");

  let attempt = 0;
  while (true) {
    const res = await fetch(`https://api.figma.com${path}`, {
      headers: {
        "X-Figma-Token": token,
      },
    });

    if (res.ok) return res.json();

    const retryAfter = Number(res.headers.get("retry-after") || "0");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new Error(`Figma API failed: ${res.status} ${await res.text()}`);
    }

    const baseWait = retryAfter > 0 ? retryAfter * 1000 : 500 * (2 ** attempt);
    await new Promise((r) => setTimeout(r, baseWait));
    attempt += 1;
  }
}
```

## node-id normalization helper

```ts
function normalizeNodeId(input: string): string {
  return input.replace(/-/g, ":");
}
```
