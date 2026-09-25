import assert from 'node:assert/strict'
import { test } from 'node:test'
import { escapeHtmlAttribute, validateShareRequest } from '../lambda/api/schema'

const valid = { result: { score: 12345, items: { item1: 1, item2: 2, item3: 3 }, variantId: 'default' } }

test('正しいペイロードは通る', () => {
  const r = validateShareRequest(valid)
  assert.equal(r.ok, true)
})

test('未知のキーは 400', () => {
  const r = validateShareRequest({ ...valid, extra: 1 })
  assert.equal(r.ok, false)
  const r2 = validateShareRequest({ result: { ...valid.result, extra: 1 } })
  assert.equal(r2.ok, false)
})

test('範囲外・非整数は 400', () => {
  for (const score of [-1, 1.5, 1e10, '1', null]) {
    const r = validateShareRequest({ result: { ...valid.result, score } })
    assert.equal(r.ok, false, `score=${String(score)}`)
  }
})

test('許可リスト外の variantId は 400（パス生成に使うため）', () => {
  for (const variantId of ['../x', 'unknown', '']) {
    const r = validateShareRequest({ result: { ...valid.result, variantId } })
    assert.equal(r.ok, false, variantId)
  }
})

test('HTML 属性エスケープ', () => {
  assert.equal(escapeHtmlAttribute(`"><script>&'`), '&quot;&gt;&lt;script&gt;&amp;&#39;')
})

test('publicBaseUrl は https://host だけを受け付ける', async () => {
  const { normalizePublicBaseUrl } = await import('../lib/config/stage')
  assert.equal(normalizePublicBaseUrl(''), '')
  assert.equal(normalizePublicBaseUrl('https://d123.cloudfront.net/'), 'https://d123.cloudfront.net')
  for (const bad of ['d123.cloudfront.net', 'http://a.example', 'https://a.example?x=1', 'https://a.example#t', 'https://a.example/sub', 'https://u:p@a.example', 'https://a b.example']) {
    assert.throws(() => normalizePublicBaseUrl(bad), bad)
  }
})
