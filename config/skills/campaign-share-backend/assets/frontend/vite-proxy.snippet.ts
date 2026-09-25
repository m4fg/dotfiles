/**
 * vite.config.ts に足す断片。
 *
 * 1. ローカル dev サーバから /api と /u をデプロイ済み dev 環境（CloudFront）へ中継する。
 *    dev は Basic 認証が掛かっているので Authorization を付与する。
 *    ⚠ 実 API に書き込むので、ローカル確認でも dev の DynamoDB / S3 にレコードが残る。
 *    E2E テストでは VITE_E2E=1 で無効化し、page.route() のモックで API を扱う。
 *
 * 2. index.html の og:image を絶対 URL にする（SNS クローラーは相対 URL を解決せず JS も実行しない）。
 *    deploy.sh がスタック出力の PublicBaseUrl を PUBLIC_BASE_URL として渡す。ローカルでは相対のまま。
 *    index.html には `<meta property="og:image" content="/assets/og-v1.png" />` のように書いておく。
 *    ⚠ assets/* は immutable 配信なので、画像を差し替えるときはファイル名（版番号）を変える。
 */
import type { Plugin, ProxyOptions } from 'vite'

const DEV_API_PROXY_TARGET = process.env.DEV_API_PROXY_TARGET ?? 'https://dxxxxxxxxxxxx.cloudfront.net'
// 資格情報はコミットしない方が望ましい（.env.local 等から読む）
const DEV_API_PROXY_BASIC_AUTH = process.env.DEV_API_PROXY_BASIC_AUTH ?? '' // 'user:pass'

export const devApiProxy: Record<string, ProxyOptions> | undefined =
  process.env.VITE_E2E === '1'
    ? undefined
    : Object.fromEntries(
        ['/api', '/u'].map((path) => [
          path,
          {
            target: DEV_API_PROXY_TARGET,
            changeOrigin: true,
            headers: DEV_API_PROXY_BASIC_AUTH
              ? { Authorization: 'Basic ' + Buffer.from(DEV_API_PROXY_BASIC_AUTH).toString('base64') }
              : {},
          } satisfies ProxyOptions,
        ]),
      )

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
const OG_PLACEHOLDER = '/assets/og-v1.png' // 差し替え時は版番号を上げる

export function absoluteOgImagePlugin(): Plugin {
  return {
    name: 'absolute-og-image',
    transformIndexHtml(html) {
      if (!html.includes(OG_PLACEHOLDER)) {
        // 置換漏れを黙って通すと相対 URL のまま本番に出るので止める
        throw new Error(`index.html に OG 画像のプレースホルダがありません: ${OG_PLACEHOLDER}`)
      }
      return PUBLIC_BASE_URL ? html.replaceAll(OG_PLACEHOLDER, `${PUBLIC_BASE_URL}${OG_PLACEHOLDER}`) : html
    },
  }
}

// 使い方:
// export default defineConfig({
//   plugins: [react(), absoluteOgImagePlugin()],
//   server: { proxy: devApiProxy },
//   preview: { proxy: devApiProxy },
// })
