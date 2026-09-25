/**
 * API Lambda（Function URL / AWS_IAM + CloudFront OAC 経由でのみ到達可能）
 *
 * - POST /api/v1/share-cards … OG 画像 + シェアページを生成し、パスを返す
 * - POST /api/v1/runs        … 結果の記録のみ（任意。改ざん可能な参考値/テレメトリ）
 * - GET  /api/v1/healthz     … 疎通確認
 *
 * 同一オリジン（CloudFront 配下）のみで使うため CORS / OPTIONS 処理は持たない。
 * og:image の絶対 URL は PUBLIC_BASE_URL 環境変数から組み立てる（リクエストの Host は信用しない）。
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { v4 as uuidv4 } from 'uuid'
import { MAX_PAYLOAD_BYTES, escapeHtmlAttribute, validateShareRequest, type ShareRequest } from './schema'
import { composeOgImage } from './render/draw'

const s3Client = new S3Client({})
const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const UPLOAD_BUCKET_NAME = process.env.UPLOAD_BUCKET_NAME
const RECORDS_TABLE_NAME = process.env.RECORDS_TABLE_NAME
const OG_TITLE = process.env.OG_TITLE ?? ''
const OG_DESCRIPTION = process.env.OG_DESCRIPTION ?? ''
/** 末尾スラッシュなし。未設定の間は share-cards が 500 を返す */
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
const SITE_TOP_PATH = process.env.SITE_TOP_PATH ?? '/'
/** 日付分割 pk のタイムゾーン（集計したい日付の基準） */
const RECORD_TIME_ZONE = 'Asia/Tokyo'

// ---------------------------------------------------------------- template

let templatePromise: Promise<string> | null = null

/** draw.ts の resolveAssetRoot と同じく、Lambda（CJS）とローカル（ESM）の両方で解決する */
function resolveTemplatePath(): string {
  const candidates: string[] = []
  if (typeof __dirname === 'string') candidates.push(path.resolve(__dirname, 'templates', 'share-redirect.html'))
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    candidates.push(path.resolve(here, 'templates', 'share-redirect.html'))
  } catch {
    /* CJS バンドルでは __dirname 側で解決される */
  }
  candidates.push(path.resolve(process.cwd(), 'lambda/api/templates/share-redirect.html'))
  const resolved = candidates.find((candidate) => existsSync(candidate))
  if (!resolved) throw new Error('Could not resolve share-redirect.html')
  return resolved
}

function getTemplate(): Promise<string> {
  templatePromise ??= readFile(resolveTemplatePath(), 'utf8')
  return templatePromise
}

/** <script> 内に埋める文字列リテラル（</script> 脱出を防ぐ） */
function jsStringLiteral(value: string): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

/**
 * テンプレートの {{KEY}} を 1 回の走査で置換する。
 * - String#replaceAll の置換文字列は `$&` などを特殊解釈するため、コールバックで値をそのまま返す
 * - 連続置換だと挿入した値の中の {{...}} が再解釈されるため、単一パスにする
 * - 未知のキーは throw（テンプレートとコードのずれを本番前に検知する）
 */
export function renderShareHtml(template: string, params: { shareUrl: string; ogImageUrl: string }): string {
  const redirectUrl = `${PUBLIC_BASE_URL}${SITE_TOP_PATH}`
  const values: Record<string, string> = {
    OG_TITLE: escapeHtmlAttribute(OG_TITLE),
    OG_DESCRIPTION: escapeHtmlAttribute(OG_DESCRIPTION),
    SHARE_URL: escapeHtmlAttribute(params.shareUrl),
    OG_IMAGE_URL: escapeHtmlAttribute(params.ogImageUrl),
    REDIRECT_URL: escapeHtmlAttribute(redirectUrl),
    REDIRECT_URL_JSON: jsStringLiteral(redirectUrl),
  }
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`Unknown template placeholder: ${key}`)
    return value
  })
}

// ---------------------------------------------------------------- helpers

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}

function bodyBuffer(event: APIGatewayProxyEventV2): Buffer {
  const source = event.body ?? ''
  return event.isBase64Encoded ? Buffer.from(source, 'base64') : Buffer.from(source, 'utf8')
}

function parseRequest(
  event: APIGatewayProxyEventV2,
): { ok: true; value: ShareRequest; raw: unknown } | { ok: false; response: APIGatewayProxyResultV2 } {
  const buffer = bodyBuffer(event)
  if (buffer.byteLength > MAX_PAYLOAD_BYTES) {
    return { ok: false, response: json(413, { message: 'Payload Too Large' }) }
  }
  let payload: unknown
  try {
    payload = JSON.parse(buffer.toString('utf8'))
  } catch {
    return { ok: false, response: json(400, { message: 'Invalid JSON' }) }
  }
  const validated = validateShareRequest(payload)
  if (!validated.ok) return { ok: false, response: json(validated.statusCode, { message: validated.message }) }
  return { ok: true, value: validated.value, raw: payload }
}

/** 日付分割の partition key（例: SHARE#2026-01-31）。日次集計が Query 1 本で済む */
function dailyPk(prefix: 'RUN' | 'SHARE', epochMs: number): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: RECORD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs)) // en-CA は YYYY-MM-DD
  return `${prefix}#${date}`
}

// ---------------------------------------------------------------- routes

async function handleRuns(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // 不正な入力は設定の有無に関係なく先に弾く（400/413 を環境変数なしでテストできる）
  const parsed = parseRequest(event)
  if (!parsed.ok) return parsed.response
  if (!RECORDS_TABLE_NAME) return json(500, { message: 'RECORDS_TABLE_NAME is not configured' })

  const id = uuidv4()
  const createdAtEpochMs = Date.now()
  await ddbDocClient.send(
    new PutCommand({
      TableName: RECORDS_TABLE_NAME,
      Item: {
        pk: dailyPk('RUN', createdAtEpochMs),
        sk: `${createdAtEpochMs}#${id}`,
        id,
        ...parsed.value.result,
        createdAtEpochMs,
        requestPayload: parsed.raw,
      },
    }),
  )
  return json(200, { ok: true, id })
}

async function handleShareCards(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const parsed = parseRequest(event)
  if (!parsed.ok) return parsed.response

  if (!UPLOAD_BUCKET_NAME || !RECORDS_TABLE_NAME) {
    return json(500, { message: 'UPLOAD_BUCKET_NAME or RECORDS_TABLE_NAME is not configured' })
  }
  if (!PUBLIC_BASE_URL) return json(500, { message: 'PUBLIC_BASE_URL is not configured' })

  const { result } = parsed.value
  // 推測不能な ID（連番にすると他人の結果を列挙できる）
  const id = uuidv4()
  const createdAtEpochMs = Date.now()

  try {
    const ogpBuffer = await composeOgImage(result)

    const sharePath = `/u/${id}.html`
    const imagePath = `/u/${id}.png`
    const html = renderShareHtml(await getTemplate(), {
      shareUrl: `${PUBLIC_BASE_URL}${sharePath}`,
      ogImageUrl: `${PUBLIC_BASE_URL}${imagePath}`,
    })

    // Cache-Control は S3 メタデータで付ける（CloudFront の u/* behavior は上書きしない設計）
    await Promise.all([
      s3Client.send(
        new PutObjectCommand({
          Bucket: UPLOAD_BUCKET_NAME,
          Key: `u/${id}.png`,
          Body: ogpBuffer,
          ContentType: 'image/png',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      ),
      s3Client.send(
        new PutObjectCommand({
          Bucket: UPLOAD_BUCKET_NAME,
          Key: `u/${id}.html`,
          Body: Buffer.from(html, 'utf8'),
          ContentType: 'text/html; charset=utf-8',
          CacheControl: 'public, max-age=60',
        }),
      ),
    ])

    // 部分失敗（S3 は成功・DynamoDB は失敗など）時は記録のないファイルが残るが、UUID パスで参照されないため
    // 実害は容量のみとして許容している。厳密に扱うなら idempotency key と処理状態を持たせる。
    // ⚠ SHARE レコードは「結果画面到達（事前生成）」の記録であり「シェア実行」数ではない。
    // requestPayload を残しておくと、レイアウト変更後に過去分の OG 画像を再生成できる。
    await ddbDocClient.send(
      new PutCommand({
        TableName: RECORDS_TABLE_NAME,
        Item: {
          pk: dailyPk('SHARE', createdAtEpochMs),
          sk: `${createdAtEpochMs}#${id}`,
          id,
          score: result.score,
          variantId: result.variantId,
          sharePath,
          imagePath,
          createdAtEpochMs,
          requestPayload: parsed.raw,
        },
      }),
    )

    return json(200, { ok: true, id, sharePath, imagePath })
  } catch (error) {
    console.error('share card generation failed', { requestId: event.requestContext.requestId, id, error })
    return json(500, { message: 'Failed to generate share card' })
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method
  const pathName = event.rawPath

  if (method === 'POST' && pathName === '/api/v1/share-cards') return handleShareCards(event)
  if (method === 'POST' && pathName === '/api/v1/runs') return handleRuns(event)
  if (method === 'GET' && pathName === '/api/v1/healthz') return json(200, { ok: true })

  return json(404, { message: 'Not Found' })
}
