import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MarketClient } from '../dist/client.js'
import { renderInteractiveChart } from '../dist/interactive.js'

test('HTML embeds all queried candles and chart scripts without a CDN dependency', async () => {
  const time = Date.parse('2026-11-01T00:00:00Z')
  const rows = Array.from({ length: 350 }, (_, i) => [time + i * 3600000, '100', '120', '90', '110', '50', time + (i + 1) * 3600000 - 1])
  const data = await new MarketClient({}, async () => Response.json(rows)).candles({ market: 'crypto', symbol: 'BTC', limit: 350 }, new AbortController().signal)
  const html = await renderInteractiveChart(data)
  const embedded = JSON.parse(html.match(/<script id="chart-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
  assert.equal(embedded.candles.length, 350, 'interactive view must retain rows beyond the static preview limit')
  assert.ok(!/<script[^>]+src=/i.test(html), 'offline HTML must contain its own chart library')
  assert.match(html, /subscribeCrosshairMove/)
  assert.match(html, /Charts by TradingView/)
  assert.match(html, /Apache License/)
  assert.match(html, /代码工作工具/)
})

test('HTML cannot turn metadata into executable markup and rejects empty data', async () => {
  const time = Date.now() - 3600000
  const data = await new MarketClient({}, async () => Response.json([[time, '100', '120', '90', '110', '1', time + 3599999]])).candles({ market: 'crypto', symbol: 'BTC' }, new AbortController().signal)
  const coverage = '</script><script id="injected">alert(1)</script>'
  const html = await renderInteractiveChart({ ...data, coverage })
  assert.ok(!html.includes('<script id="injected">'))
  const embedded = JSON.parse(html.match(/<script id="chart-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
  assert.equal(embedded.coverage, coverage)
  await assert.rejects(renderInteractiveChart({ ...data, candles: [] }), /没有 K 线/)
})
