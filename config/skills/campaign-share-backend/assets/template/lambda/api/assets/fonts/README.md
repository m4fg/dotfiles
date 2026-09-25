# フォント

OG 画像に使うフォント（.ttf / .otf）を置く。ライセンス（OFL 等）を確認し、配布可能なものだけ。
ファイル名は render/layout.ts の `OG_FONT_FILE` に合わせる。
日本語を描く場合はサブセット化して容量を抑える（Lambda のパッケージ上限と cold start のため）。
