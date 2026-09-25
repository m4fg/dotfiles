/**
 * サーバ API クライアント（フロント側。src/api/client.ts などに置く）
 *
 * - エンドポイントは CloudFront の `api/*` behavior（ルート直下）に固定。
 *   Vite `base: './'` の相対解決に依存しないよう location.origin から組み立てる
 *   （サブディレクトリ配信にする場合はここを直す）
 * - Lambda Function URL は AWS_IAM + OAC のため、POST には
 *   `x-amz-content-sha256`（本文の SHA-256 hex）が必須
 * - crypto.subtle は安全なコンテキスト（https / localhost）でのみ使える
 */

import type { ResultPayload } from './types' // サイトの結果型。backend の schema.ts と揃える

export interface ShareCard {
  /** シェア用 URL（絶対 URL。/u/{id}.html） */
  shareUrl: string
  /** OG 画像の絶対 URL（/u/{id}.png）。画像 DL に使う */
  imageUrl: string
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function postJson(path: string, body: unknown): Promise<Response> {
  // ハッシュを取った文字列と送る文字列を必ず同一にする（再 stringify すると署名不一致で 403）
  const payload = JSON.stringify(body)
  return fetch(new URL(path, window.location.origin), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-amz-content-sha256': await sha256Hex(payload),
    },
    body: payload,
  })
}

/** 結果の記録（任意）。fire-and-forget。失敗してもゲーム進行・結果表示を止めない */
export function submitRun(result: ResultPayload): void {
  void postJson('/api/v1/runs', { result })
    .then((res) => {
      if (!res.ok) console.warn(`[API] runs failed (${res.status})`)
    })
    .catch((error) => console.warn('[API] runs failed', error))
}

/**
 * シェアカード生成。結果画面の「表示時」に呼んで事前生成しておく。
 * シェアボタン押下時は生成済み URL を同期的に使う（window.open / navigator.share は
 * ユーザー操作直後でないとポップアップブロックされるため、押下後に await できない）。
 * 結果オブジェクト単位でメモ化し、React StrictMode の二重 effect でも二重 POST しない。
 */
const shareCardCache = new WeakMap<ResultPayload, Promise<ShareCard>>()

export function createShareCard(result: ResultPayload): Promise<ShareCard> {
  let cached = shareCardCache.get(result)
  if (!cached) {
    cached = postJson('/api/v1/share-cards', { result }).then(async (res) => {
      if (!res.ok) throw new Error(`share-cards API failed (${res.status})`)
      const data = (await res.json()) as { sharePath?: unknown; imagePath?: unknown }
      if (typeof data.sharePath !== 'string' || typeof data.imagePath !== 'string') {
        throw new Error('share-cards API returned an unexpected response')
      }
      return {
        shareUrl: new URL(data.sharePath, window.location.origin).toString(),
        imageUrl: new URL(data.imagePath, window.location.origin).toString(),
      }
    })
    // 失敗はキャッシュに残さない（再表示でリトライできるように）
    cached.catch(() => shareCardCache.delete(result))
    shareCardCache.set(result, cached)
  }
  return cached
}
