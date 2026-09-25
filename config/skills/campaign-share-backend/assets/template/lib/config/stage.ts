export type DeployStage = 'dev' | 'prod'

export type StageConfig = {
  stage: DeployStage
  resourcePrefix: string
  /** dev のみ使用。閲覧制限用途であり機密境界ではない */
  basicAuthUsername: string
  basicAuthPassword: string
  /**
   * CloudFront に割り当てる独自ドメイン。指定すると us-east-1 に ACM 証明書スタックが作られ、
   * Distribution の alias になる。DNS（検証用 CNAME・本体の CNAME）は手動登録。
   */
  customDomainName?: string
  /**
   * 公開ベース URL（og:image の絶対 URL 用。Lambda の PUBLIC_BASE_URL になる）。末尾スラッシュなし。
   * dev は初回デプロイ後に判明する CloudFront 既定ドメインを記入して再デプロイする。
   * 空文字の間は share-cards API が 500 を返す（他 API は影響なし）。
   */
  publicBaseUrl: string
}

const CUSTOM_DOMAIN_NAME: Record<DeployStage, string | undefined> = {
  dev: undefined,
  prod: undefined, // 例: 'campaign.example.com'
}

const PUBLIC_BASE_URL: Record<DeployStage, string> = {
  dev: '', // 例: 'https://dxxxxxxxxxxxx.cloudfront.net'（初回デプロイ後に記入）
  prod: CUSTOM_DOMAIN_NAME.prod ? `https://${CUSTOM_DOMAIN_NAME.prod}` : '',
}

// 既定値はリポジトリに残るので、推測されにくい値にするか環境変数で渡す
const DEFAULT_BASIC_AUTH_USERNAME = '__BASIC_USER__'
const DEFAULT_BASIC_AUTH_PASSWORD = '__BASIC_PASS__'

/**
 * 公開ベース URL を検証して origin（https://host[:port]、末尾スラッシュなし）に正規化する。
 * 後ろに `/u/{id}.png` を連結するので、パス・クエリ・フラグメント・認証情報を含む値は synth 時に止める。
 * 空は許容（初回デプロイ前。share-cards だけが 500 を返す）
 */
export function normalizePublicBaseUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(`publicBaseUrl is not a valid URL: "${input}"（例: https://dxxxx.cloudfront.net）`)
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    trimmed.replace(/\/+$/, '') !== url.origin
  ) {
    throw new Error(`publicBaseUrl must be exactly "https://host" (got "${input}")`)
  }
  return url.origin
}

export function resolveStage(stageInput: unknown): StageConfig {
  // 未指定は dev。明示された値のタイプミス（例: prd）は黙って dev に落とさずエラーにする
  const normalized = typeof stageInput === 'string' ? stageInput.toLowerCase() : 'dev'
  if (normalized !== 'dev' && normalized !== 'prod') {
    throw new Error(`Unknown stage "${String(stageInput)}". Use --context stage=dev or stage=prod.`)
  }
  const stage: DeployStage = normalized

  // 完全な https URL（例: https://dxxxx.cloudfront.net）であること。ホスト名だけ貼る誤りを synth 時に止める。
  // 空は許容（初回デプロイ前。share-cards だけが 500 を返す）
  const publicBaseUrl = normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL ?? PUBLIC_BASE_URL[stage])

  return {
    stage,
    resourcePrefix: `__PREFIX__-${stage}`,
    basicAuthUsername: process.env.BASIC_AUTH_USERNAME ?? DEFAULT_BASIC_AUTH_USERNAME,
    basicAuthPassword: process.env.BASIC_AUTH_PASSWORD ?? DEFAULT_BASIC_AUTH_PASSWORD,
    customDomainName: CUSTOM_DOMAIN_NAME[stage],
    publicBaseUrl,
  }
}
