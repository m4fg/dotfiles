import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GlobalFonts, createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { ITEM_IDS, type ResultPayload } from '../schema.js'
import {
  ITEM_FIELDS,
  OG_FONT_FAMILY,
  OG_FONT_FILE,
  OG_HEIGHT,
  OG_WIDTH,
  SCORE_FIELD,
  type TextField,
  type TextStyle,
} from './layout.js'

/**
 * assets/ の場所を解決する。
 * - Lambda 上（esbuild の CJS バンドル）: handler と同階層に assets/ がコピーされている → __dirname
 * - ローカル（tsx --test の ESM）: import.meta.url から相対
 * CJS バンドルでは import.meta.url が空になるため try で保護し、両方を候補にする。
 */
function resolveAssetRoot(): string {
  const candidates: string[] = []
  if (typeof __dirname === 'string') candidates.push(path.resolve(__dirname, 'assets'))
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    candidates.push(path.resolve(here, '../assets'))
  } catch {
    /* CJS バンドルでは __dirname 側で解決される */
  }
  candidates.push(path.resolve(process.cwd(), 'lambda/api/assets'))
  candidates.push(path.resolve(process.cwd(), 'backend/lambda/api/assets'))

  const resolved = candidates.find((candidate) => existsSync(candidate))
  if (!resolved) throw new Error('Could not resolve api asset directory')
  return resolved
}

export const ASSET_ROOT = resolveAssetRoot()

// フォントは初回描画時に 1 回だけ登録（コンテナ再利用時は再登録しない）。
// モジュール読み込み時に登録すると、フォント未配置の段階で handler 全体（healthz 含む）が起動しなくなる。
// 登録失敗を黙って既定フォントで描くと気付けないので throw する。
function ensureFontRegistered(): void {
  if (GlobalFonts.has(OG_FONT_FAMILY)) return
  const fontPath = path.join(ASSET_ROOT, OG_FONT_FILE)
  const registered = GlobalFonts.registerFromPath(fontPath, OG_FONT_FAMILY)
  if (!registered || !GlobalFonts.has(OG_FONT_FAMILY)) {
    throw new Error(`Failed to register font from ${fontPath}`)
  }
}

/** 下地 PNG（assets/ 相対）。variantId は schema.ts で許可リスト照合済み */
export function resolveOgBase(variantId: string): string {
  return `og/${variantId}.png`
}

// 下地画像のデコード結果をコンテナ内でキャッシュ（失敗はキャッシュしない）
const imageCache = new Map<string, ReturnType<typeof loadImage>>()
function loadAssetImage(localPath: string) {
  let cached = imageCache.get(localPath)
  if (!cached) {
    cached = loadImage(path.join(ASSET_ROOT, localPath))
    cached.catch(() => imageCache.delete(localPath))
    imageCache.set(localPath, cached)
  }
  return cached
}

function fontSpec(style: TextStyle, sizePx: number): string {
  return `${style.fontWeight} ${sizePx}px ${OG_FONT_FAMILY}`
}

/** 箱幅に収まるフォントサイズ（収まらないときだけ比例縮小） */
export function fitFontSize(ctx: SKRSContext2D, text: string, field: TextField): number {
  const { style } = field
  ctx.font = fontSpec(style, style.fontSizePx)
  ctx.letterSpacing = `${style.letterSpacingPx}px`
  const width = ctx.measureText(text).width
  if (width <= field.box.width) return style.fontSizePx
  return Math.max(style.minFontSizePx, Math.floor((style.fontSizePx * field.box.width) / width))
}

/**
 * 箱の中にテキストを描く。縦は「キャップハイト（数字の高さ）」を箱の中央に置く。
 * デザインツールの行ボックス中央とフォントの ascent/descent はずれるため、実測値で合わせる。
 * 縁取りは stroke がパス中心に描かれるので 2 倍幅で先に描き、上から fill で内側を隠す（= OUTSIDE ストローク）。
 */
export function drawTextField(ctx: SKRSContext2D, text: string, field: TextField): void {
  const { box, style, align } = field
  const sizePx = fitFontSize(ctx, text, field)
  ctx.font = fontSpec(style, sizePx)
  ctx.letterSpacing = `${style.letterSpacingPx}px`
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'

  const cap = ctx.measureText('0').actualBoundingBoxAscent
  const baselineY = box.y + box.height / 2 + cap / 2
  // canvas の右揃えは末尾の letterSpacing も幅に含むため、その分右へずらす
  const x =
    align === 'left' ? box.x : align === 'center' ? box.x + box.width / 2 : box.x + box.width + style.letterSpacingPx

  if (style.strokeWeight > 0) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = style.strokeWeight * 2
    ctx.strokeStyle = style.strokeColor
    ctx.strokeText(text, x, baselineY)
  }
  if (typeof style.fill === 'string') {
    ctx.fillStyle = style.fill
  } else {
    const gradient = ctx.createLinearGradient(x, box.y, x, box.y + box.height)
    for (const [offset, color] of style.fill) gradient.addColorStop(offset, color)
    ctx.fillStyle = gradient
  }
  ctx.fillText(text, x, baselineY)
  ctx.letterSpacing = '0px'
}

/** OG 画像（1200×630 PNG）を合成する: 下地 → 動的テキスト */
export async function composeOgImage(result: ResultPayload): Promise<Buffer> {
  ensureFontRegistered()
  const baseImage = await loadAssetImage(resolveOgBase(result.variantId))

  const canvas = createCanvas(OG_WIDTH, OG_HEIGHT)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(baseImage, 0, 0, OG_WIDTH, OG_HEIGHT)

  drawTextField(ctx, result.score.toLocaleString('en-US'), SCORE_FIELD)

  ITEM_IDS.forEach((id, index) => {
    const { firstBox, rowGap, align, style } = ITEM_FIELDS
    drawTextField(ctx, String(result.items[id]), {
      box: { ...firstBox, y: firstBox.y + index * rowGap },
      align,
      style,
    })
  })

  // SNS 側で再圧縮されるので PNG で十分。写真系の下地で容量が大きい場合は 'image/jpeg' + 品質 85 程度も可
  return canvas.toBuffer('image/png')
}
