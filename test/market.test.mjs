import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarketClient, candleEnd } from '../dist/client.js'
import { loadConnection, resolveConfig } from '../dist/config.js'
import { getJson } from '../dist/http.js'
import { instrument } from '../dist/validation.js'
import { renderChart, renderCsv } from '../dist/chart.js'

const NOW = Date.parse('2026-11-12T15:00:00Z')
const signal = () => new AbortController().signal
const config = { connectionFile: '/missing-dsh-market-config', timeoutMs: 1000 }
const ticker = { openPrice: '100', highPrice: '120', lowPrice: '90', volume: '1234', closeTime: NOW, bidPrice: '109', askPrice: '111' }
const trade = { price: '110', time: NOW - 1000 }
const cryptoFetch = async url => Response.json(new URL(url).pathname.endsWith('/trades') ? [trade] : ticker)
const bar = (time, o = 100) => [time, String(o), String(o + 20), String(o - 10), String(o + 10), '100', time + 3600_000 - 1]
async function stockFile(t, feed = 'iex') {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-market-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'connection.json')
  await writeFile(file, JSON.stringify({ keyId: 'test-key', secretKey: 'test-secret', feed }), { mode: 0o600 })
  return file
}
function clearStockEnv(t) {
  for (const name of ['APCA_API_KEY_ID', 'APCA_API_SECRET_KEY', 'DSH_MARKET_STOCK_FEED']) {
    const previous = process.env[name]
    delete process.env[name]
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous })
  }
}
beforeEach(t => clearStockEnv(t))

test('symbols require an explicit market and normalize crypto pairs without changing stock class shares', () => {
  for (const symbol of ['btc', 'BTCUSDT', 'BTC/USDT', 'BTC-USDT']) assert.deepEqual(instrument({ market: 'crypto', symbol }), { market: 'crypto', symbol: 'BTCUSDT' })
  assert.equal(instrument({ market: 'crypto', symbol: 'ETHBTC' }).symbol, 'ETHBTC')
  assert.equal(instrument({ market: 'us', symbol: 'brk.b' }).symbol, 'BRK.B')
  for (const args of [{ symbol: 'BTC' }, { market: 'us', symbol: '../../a' }, { market: 'crypto', symbol: 'BTC?foo=bar' }]) assert.throws(() => instrument(args))
})

test('crypto quote uses actual trade time, keeps stablecoin denomination, and deduplicates inputs', async () => {
  let calls = 0
  const client = new MarketClient(config, async (url, init) => {
    calls++
    assert.equal(new URL(url).origin, 'https://data-api.binance.vision')
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers['APCA-API-KEY-ID'], undefined)
    return cryptoFetch(url)
  }, () => NOW)
  const result = await client.quotes({ instruments: [{ market: 'crypto', symbol: 'BTC' }, { market: 'crypto', symbol: 'BTC/USDT' }] }, signal())
  assert.equal(calls, 2)
  assert.equal(result.complete, true)
  assert.equal(result.quotes[0].price, 110)
  assert.equal(result.quotes[0].currency, 'USDT')
  assert.equal(result.quotes[0].ageSeconds, 1)
  assert.equal(result.quotes[0].changePercent, 10)
  assert.equal(result.quotes[0].changeBasis, 'rolling_24h')
  assert.equal(result.quotes[0].stale, false)
})

test('old trades remain stale even with a current statistics window', async () => {
  const client = new MarketClient(config, async url => Response.json(new URL(url).pathname.endsWith('/trades') ? [{ ...trade, time: NOW - 3600_000 }] : ticker), () => NOW)
  const result = await client.quote({ market: 'crypto', symbol: 'BTC' }, signal())
  assert.equal(result.stale, true)
  assert.equal(result.ageSeconds, 3600)
  assert.equal(result.statisticsWindowEnd, new Date(NOW).toISOString())
})

test('mixed batch preserves crypto success when stock credentials are absent', async t => {
  const client = new MarketClient(config, cryptoFetch, () => NOW)
  const result = await client.quotes({ instruments: [{ market: 'crypto', symbol: 'BTC' }, { market: 'us', symbol: 'AAPL' }] }, signal())
  assert.equal(result.complete, false)
  assert.equal(result.quotes.length, 1)
  assert.equal(result.errors[0].symbol, 'AAPL')
  assert.match(result.errors[0].message, /Alpaca Key/)
})

test('stock snapshot uses configured feed, computes previous-close change, and preserves separate book time', async t => {
  const file = await stockFile(t)
  const client = new MarketClient({ ...config, connectionFile: file }, async (url, init) => {
    assert.equal(new URL(url).pathname, '/v2/stocks/AAPL/snapshot')
    assert.equal(new URL(url).searchParams.get('feed'), 'iex')
    assert.equal(init.headers['APCA-API-KEY-ID'], 'test-key')
    assert.equal(init.headers['APCA-API-SECRET-KEY'], 'test-secret')
    return Response.json({ latestTrade: { p: 110, t: new Date(NOW - 1000).toISOString() }, latestQuote: { bp: 109, ap: 111, t: new Date(NOW - 500).toISOString() }, dailyBar: { o: 101, h: 120, l: 90, v: 123, t: '2026-11-12T05:00:00Z' }, prevDailyBar: { c: 100 } })
  }, () => NOW)
  const q = await client.quote({ market: 'us', symbol: 'AAPL' }, signal())
  assert.equal(q.changePercent, 10)
  assert.equal(q.changeBasis, 'previous_daily_close')
  assert.equal(q.currency, 'USD')
  assert.match(q.coverage, /IEX/)
  assert.notEqual(q.sourceAt, q.quoteAt)
  assert.ok(!JSON.stringify(q).includes('test-secret'))
})

test('missing stock trades are explicit nulls, never fabricated zero prices', async t => {
  const file = await stockFile(t)
  const result = await new MarketClient({ ...config, connectionFile: file }, async () => Response.json({}), () => NOW).quote({ market: 'us', symbol: 'NEW' }, signal())
  assert.equal(result.price, null)
  assert.equal(result.sourceAt, null)
  assert.equal(result.stale, true)
})

test('crypto candles preserve incomplete bars, sorted OHLCV and end-exclusive input', async () => {
  const client = new MarketClient(config, async url => {
    const params = new URL(url).searchParams
    assert.equal(params.get('symbol'), 'BTCUSDT')
    assert.equal(params.get('endTime'), String(NOW - 1))
    return Response.json([bar(NOW), bar(NOW - 3600_000)])
  }, () => NOW)
  const result = await client.candles({ market: 'crypto', symbol: 'BTC', interval: '1h', end: new Date(NOW).toISOString(), limit: 2 }, signal())
  assert.equal(result.candles[0].closed, true)
  assert.equal(result.candles[1].closed, false)
  assert.equal(result.candles[0].endTime, new Date(NOW).toISOString())
  assert.equal(result.hasMore, true)
  assert.equal(result.adjustment, 'raw')
})

test('stock bars request newest page, return chronological data and stable pagination window', async t => {
  const file = await stockFile(t), requests = []
  const client = new MarketClient({ ...config, connectionFile: file }, async url => {
    const p = new URL(url).searchParams; requests.push(p)
    assert.equal(p.get('sort'), 'desc'); assert.equal(p.get('adjustment'), 'raw')
    return Response.json({ bars: { AAPL: [{ t: '2026-11-12T14:00:00Z', o: 100, h: 120, l: 90, c: 110, v: 10 }, { t: '2026-11-12T13:00:00Z', o: 101, h: 120, l: 90, c: 110, v: 20 }] }, next_page_token: 'next' })
  }, () => NOW)
  const input = { market: 'us', symbol: 'AAPL', interval: '1h', limit: 2 }
  const result = await client.candles(input, signal())
  assert.equal(result.candles[0].time, '2026-11-12T13:00:00.000Z')
  assert.equal(result.nextPageToken, 'next')
  assert.ok(result.rangeStart && result.rangeEnd)
  await client.candles({ ...input, start: result.rangeStart, end: result.rangeEnd, pageToken: 'next' }, signal())
  assert.equal(requests[1].get('start'), requests[0].get('start'))
  assert.equal(requests[1].get('end'), requests[0].get('end'))
  await assert.rejects(client.candles({ ...input, pageToken: 'next' }, signal()), /rangeStart/)
})

test('delayed SIP bars map to SIP with a fifteen-minute cutoff and honest metadata', async t => {
  const file = await stockFile(t, 'delayed_sip')
  const client = new MarketClient({ ...config, connectionFile: file }, async url => {
    const p = new URL(url).searchParams
    assert.equal(p.get('feed'), 'sip')
    assert.equal(p.get('end'), new Date(NOW - 900_000).toISOString())
    return Response.json({ bars: {}, next_page_token: null })
  }, () => NOW)
  const result = await client.candles({ market: 'us', symbol: 'AAPL' }, signal())
  assert.equal(result.feed, 'delayed_sip'); assert.equal(result.delaySeconds, 900)
  assert.deepEqual(result.candles, [])
})

test('calendar bars handle month length, leap years and New York DST', () => {
  assert.equal(candleEnd('2024-02-01T00:00:00Z', '1M', 'UTC'), '2024-03-01T00:00:00.000Z')
  assert.equal(candleEnd('2026-03-08T05:00:00Z', '1d', 'America/New_York'), '2026-03-09T04:00:00.000Z')
  assert.equal(candleEnd('2026-11-01T04:00:00Z', '1d', 'America/New_York'), '2026-11-02T05:00:00.000Z')
})

test('invalid queries fail before network requests and inconsistent bars fail closed', async () => {
  const client = new MarketClient(config, async () => { throw Error('network must not be called') })
  for (const extra of [{ limit: 1001 }, { interval: '1s' }, { start: '2026-11-01' }, { start: '2026-11-12T00:00:00Z', end: '2026-11-01T00:00:00Z' }]) await assert.rejects(client.candles({ market: 'crypto', symbol: 'BTC', ...extra }, signal()), error => !error.message.includes('network'))
  await assert.rejects(new MarketClient(config, async () => Response.json([[NOW, '100', '50', '200', '100', '1', NOW + 1]])).candles({ market: 'crypto', symbol: 'BTC' }, signal()), /不一致/)
})

test('depth reports no invented exchange timestamp and rejects stock depth', async () => {
  const client = new MarketClient(config, async () => Response.json({ lastUpdateId: 42, bids: [['100', '2']], asks: [['101', '3']] }), () => NOW)
  const result = await client.orderbook({ market: 'crypto', symbol: 'BTC' }, signal())
  assert.equal(result.spread, 1); assert.equal(result.sourceAt, null)
  await assert.rejects(client.orderbook({ market: 'us', symbol: 'AAPL' }, signal()), /仅支持/)
})

test('HTTP enforces response byte caps on chunked bodies and content-length', async () => {
  const options = resolveConfig({ ...config, maxResponseBytes: 1024 })
  for (const headers of [{}, { 'content-length': '2048' }]) await assert.rejects(getJson(new URL('https://example.com'), {}, options, signal(), async () => new Response('x'.repeat(2048), { headers })), /大小上限/)
})

test('HTTP errors redact arbitrary upstream bodies and preserve bounded rate limit hints', async () => {
  const secret = 'do-not-leak-credential'
  await assert.rejects(getJson(new URL('https://example.com'), {}, resolveConfig(config), signal(), async () => new Response(secret, { status: 429, headers: { 'retry-after': '12' } })), error => error.status === 429 && error.retryAfterSeconds === 12 && !error.message.includes(secret))
})

test('caller cancellation interrupts hanging body reads and releases the reader', async () => {
  const caller = new AbortController(); let cancelled = false
  const promise = getJson(new URL('https://example.com'), {}, resolveConfig(config), caller.signal, async () => new Response(new ReadableStream({ cancel() { cancelled = true } })))
  setTimeout(() => caller.abort(new Error('cancelled-by-test')), 10)
  await assert.rejects(promise, /cancelled-by-test/)
  assert.equal(cancelled, true)
})

test('credentials rotate without restart, enforce permissions and stay out of status', async t => {
  const file = await stockFile(t)
  assert.equal((await loadConnection(file)).keyId, 'test-key')
  await writeFile(file, JSON.stringify({ keyId: 'new-key', secretKey: 'new-secret', feed: 'sip' }))
  assert.equal((await loadConnection(file)).keyId, 'new-key')
  const status = await new MarketClient({ ...config, connectionFile: file }).status()
  assert.equal(status.us.configured, true)
  assert.ok(!JSON.stringify(status).includes('new-key'))
  if (process.platform !== 'win32') {
    await chmod(file, 0o644)
    await assert.rejects(loadConnection(file), /chmod 600/)
    // Crypto does not read the broken stock configuration.
    assert.equal((await new MarketClient({ ...config, connectionFile: file }, cryptoFetch, () => NOW).quote({ market: 'crypto', symbol: 'BTC' }, signal())).price, 110)
  }
})

test('watch stops on upstream failure with explicit partial samples and enforces its bounded budget', async () => {
  let requests = 0
  const client = new MarketClient(config, async () => { requests++; return new Response(null, { status: 429 }) })
  const input = { instruments: [{ market: 'crypto', symbol: 'BTC' }], samples: 3, intervalSeconds: 2 }
  const result = await client.watch(input, signal())
  assert.equal(result.complete, false); assert.equal(result.snapshots.length, 1)
  assert.equal(requests, 2); assert.match(result.stoppedReason, /错误/)
  await assert.rejects(client.watch({ ...input, samples: 12, intervalSeconds: 30 }, signal()), /60 秒/)
})

test('watch cancellation aborts its polling sleep immediately', async () => {
  const client = new MarketClient(config, cryptoFetch, () => NOW), caller = new AbortController()
  const promise = client.watch({ instruments: [{ market: 'crypto', symbol: 'BTC' }], samples: 3, intervalSeconds: 30 }, caller.signal)
  setTimeout(() => caller.abort(new Error('stop-watch')), 20)
  await assert.rejects(promise, /stop-watch/)
})

test('chart and CSV retain provenance, incomplete state and all requested data', async () => {
  const data = await new MarketClient(config, async () => Response.json([bar(NOW - 3600_000), bar(NOW)]), () => NOW).candles({ market: 'crypto', symbol: 'BTC' }, signal())
  const svg = renderChart(data), csv = renderCsv(data)
  assert.match(svg, /BTCUSDT/); assert.match(svg, /binance \/ spot/)
  assert.match(svg, /INCOMPLETE/); assert.match(svg, /stroke-dasharray/)
  assert.ok(!svg.includes('NaN')); assert.ok(!svg.includes('<script'))
  assert.equal(csv.trim().split('\r\n').length, 3)
  assert.match(csv, /USDT,1h,binance,spot,0/)
  assert.throws(() => renderChart({ ...data, candles: [] }), /没有 K 线/)
})
