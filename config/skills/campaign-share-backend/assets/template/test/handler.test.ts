import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { handler, renderShareHtml } from '../lambda/api/handler'

function event(method: string, rawPath: string, body?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath,
    rawQueryString: '',
    headers: {},
    body,
    requestContext: {
      accountId: 'test',
      apiId: 'test',
      domainName: 'example.test',
      domainPrefix: 'example',
      http: { method, path: rawPath, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'test',
      routeKey: '$default',
      stage: '$default',
      time: '',
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  }
}

async function call(e: APIGatewayProxyEventV2) {
  return (await handler(e)) as APIGatewayProxyStructuredResultV2
}

test('healthz', async () => {
  const res = await call(event('GET', '/api/v1/healthz'))
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers?.['Cache-Control'], 'no-store')
})

test('未知のパスは 404', async () => {
  const res = await call(event('GET', '/api/v1/unknown'))
  assert.equal(res.statusCode, 404)
})

test('シェア HTML: 全プレースホルダが置換され、特殊文字がエスケープされる', () => {
  const template = readFileSync(path.resolve('lambda/api/templates/share-redirect.html'), 'utf8')
  const html = renderShareHtml(template, {
    shareUrl: 'https://example.test/u/x.html',
    ogImageUrl: 'https://example.test/u/x.png?a="b"&$&',
  })
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/)
  assert.match(html, /og:image" content="https:\/\/example\.test\/u\/x\.png\?a=&quot;b&quot;&amp;\$&amp;"/)
  assert.match(html, /twitter:card" content="summary_large_image"/)
})

test('シェア HTML: 未知のプレースホルダは throw', () => {
  assert.throws(() => renderShareHtml('{{UNKNOWN}}', { shareUrl: '', ogImageUrl: '' }))
})

test('share-cards / runs: 不正な JSON は 400、上限超えの本文は 413', async () => {
  for (const route of ['/api/v1/share-cards', '/api/v1/runs']) {
    assert.equal((await call(event('POST', route, '{'))).statusCode, 400, route)
    assert.equal((await call(event('POST', route, JSON.stringify({ result: {} })))).statusCode, 400, route)
    assert.equal((await call(event('POST', route, 'x'.repeat(3000)))).statusCode, 413, route)
  }
})
