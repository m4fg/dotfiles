/**
 * API ペイロード検証（純関数・単体テスト対象）
 *
 * ここはサイトごとに書き換える。方針:
 *   - 許可キー以外は 400（hasOnlyKeys）。フロントの型とずれたら即気付ける
 *   - 数値は安全な整数・範囲チェック。ID は許可リスト照合（パス生成に使うため必須）
 *   - 値どうしの整合（合計 = 内訳の和、タイプと ID の対応など）も見る
 *   - 本文サイズ上限（MAX_PAYLOAD_BYTES）で 413
 *
 * ⚠ クライアント生成値なので改ざんは防げない。ランキング・抽選・応募判定には使わない。
 *   それらが必要ならサーバ側でゲーム進行を検証する別設計が要る。
 */

export const MAX_PAYLOAD_BYTES = 2048

/** OG 画像の下地を切り替えるキー（例: 診断タイプ・キャラ・到達ランク）。下地 PNG のファイル名と一致させる */
export const VARIANT_IDS = ['default'] as const
export type VariantId = (typeof VARIANT_IDS)[number]

/** 内訳を持つ場合の例（不要なら削除） */
export const ITEM_IDS = ['item1', 'item2', 'item3'] as const
export type ItemId = (typeof ITEM_IDS)[number]

const MAX_SCORE = 1_000_000_000
const MAX_ITEM_COUNT = 10_000

export interface ResultPayload {
  score: number
  items: Record<ItemId, number>
  variantId: VariantId
}

export interface ShareRequest {
  result: ResultPayload
}

export type ValidationResult =
  | { ok: true; value: ShareRequest }
  | { ok: false; statusCode: number; message: string }

function fail(message: string): ValidationResult {
  return { ok: false, statusCode: 400, message }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(obj).every((key) => allowed.includes(key))
}

export function validateShareRequest(payload: unknown): ValidationResult {
  if (!isPlainObject(payload)) return fail('payload must be an object')
  if (!hasOnlyKeys(payload, ['result'])) return fail('payload has unknown keys')

  const { result } = payload
  if (!isPlainObject(result)) return fail('result must be an object')
  if (!hasOnlyKeys(result, ['score', 'items', 'variantId'])) return fail('result has unknown keys')

  const { score, items, variantId } = result
  if (!isCount(score, MAX_SCORE)) return fail('score is invalid')

  if (!isPlainObject(items) || !hasOnlyKeys(items, ITEM_IDS)) return fail('items is invalid')
  for (const id of ITEM_IDS) {
    if (!isCount(items[id], MAX_ITEM_COUNT)) return fail(`items.${id} is invalid`)
  }

  // ID は S3 キー・アセットパスに使うので必ず許可リストで照合する（パストラバーサル対策）
  if (typeof variantId !== 'string' || !(VARIANT_IDS as readonly string[]).includes(variantId)) {
    return fail('variantId is invalid')
  }

  return {
    ok: true,
    value: {
      result: {
        score,
        items: Object.fromEntries(ITEM_IDS.map((id) => [id, items[id] as number])) as Record<ItemId, number>,
        variantId: variantId as VariantId,
      },
    },
  }
}

/** HTML 属性値として安全な文字列にエスケープする（テンプレート埋め込み用） */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
