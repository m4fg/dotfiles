/**
 * OG 画像レイアウト定数（1200×630）
 *
 * 下地 PNG（assets/og/{variantId}.png）はデザインツールから書き出したもので、
 * 動的に描く領域（スコア・個数・名前など）だけ空けてある。ここで定義する座標に Lambda が描く。
 * 座標はデザインデータ（Figma のノード座標など）の実測値を写す。
 * レイアウトはこのファイルに集約し、描画ロジック（draw.ts）には数値を直書きしない。
 * DB にリクエスト全文を保存しておけば、レイアウト変更後に過去分を再生成できる。
 */

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

/** 同梱フォント（assets/fonts/ 配下）。family 名は canvas の font 指定で使う */
export const OG_FONT_FILE = 'fonts/__FONT_FILE__.ttf'
export const OG_FONT_FAMILY = '__FONT_FAMILY__'

export type TextStyle = {
  fontSizePx: number
  /** 箱幅に収まらないときの縮小下限 */
  minFontSizePx: number
  fontWeight: 'normal' | 'bold'
  fill: string | ReadonlyArray<readonly [number, string]> // 単色 or 縦グラデーション stops
  /** 縁取り（Figma の OUTSIDE ストローク相当）。0 で無し */
  strokeWeight: number
  strokeColor: string
  letterSpacingPx: number
}

/**
 * 描画する 1 フィールド。箱（x, y, width, height）の中に align で配置し、縦はキャップハイト中央。
 * 箱はデザインのテキストボックスそのもの（Figma の absoluteBoundingBox）を写す。
 */
export type TextField = {
  box: { x: number; y: number; width: number; height: number }
  align: 'left' | 'center' | 'right'
  style: TextStyle
}

const numberStyle: TextStyle = {
  fontSizePx: 90,
  minFontSizePx: 48,
  fontWeight: 'bold',
  fill: '#ffffff',
  strokeWeight: 4,
  strokeColor: '#000000',
  letterSpacingPx: 0,
}

/** 合計スコア（例） */
export const SCORE_FIELD: TextField = {
  box: { x: 700, y: 500, width: 440, height: 64 },
  align: 'center',
  style: numberStyle,
}

/** 内訳（例）: ITEM_IDS の順に縦に並べる */
export const ITEM_FIELDS = {
  firstBox: { x: 560, y: 380, width: 80, height: 24 },
  rowGap: 28,
  align: 'right',
  style: { ...numberStyle, fontSizePx: 30, minFontSizePx: 20, strokeWeight: 2 },
} as const
