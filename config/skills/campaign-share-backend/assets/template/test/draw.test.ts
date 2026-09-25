/**
 * 描画テスト。フォントと全 variant の下地 PNG が揃っていないと失敗する
 * （揃っていないまま deploy すると share-cards が 500 になるため、skip にはしない）。
 * 素材待ちの間だけ ALLOW_MISSING_OG_ASSETS=1 でスキップできる。
 * 生成画像は temp/og-preview/ に書き出して目視確認にも使う。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { ASSET_ROOT, composeOgImage, resolveOgBase } from '../lambda/api/render/draw'
import { OG_FONT_FILE, OG_HEIGHT, OG_WIDTH } from '../lambda/api/render/layout'
import { VARIANT_IDS, type ResultPayload } from '../lambda/api/schema'

const missing = [OG_FONT_FILE, ...VARIANT_IDS.map(resolveOgBase)].filter(
  (p) => !existsSync(path.join(ASSET_ROOT, p)),
)
const skip = missing.length > 0 && process.env.ALLOW_MISSING_OG_ASSETS === '1' && `missing: ${missing.join(', ')}`

test('フォントと全 variant の下地が揃っている', { skip }, () => {
  assert.deepEqual(missing, [], `assets/ に未配置: ${missing.join(', ')}`)
})

function pngSize(buffer: Buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

test('全 variant で 1200x630 の PNG が生成できる（最大桁数でも）', { skip: skip || missing.length > 0 }, async () => {
  const outDir = path.resolve('temp/og-preview')
  mkdirSync(outDir, { recursive: true })
  for (const variantId of VARIANT_IDS) {
    for (const score of [0, 1_000_000_000]) {
      const result: ResultPayload = { score, items: { item1: 9999, item2: 0, item3: 12 }, variantId }
      const png = await composeOgImage(result)
      assert.deepEqual(pngSize(png), { width: OG_WIDTH, height: OG_HEIGHT })
      writeFileSync(path.join(outDir, `${variantId}-${score}.png`), png)
    }
  }
})
