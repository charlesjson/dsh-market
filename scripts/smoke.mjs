import assert from 'node:assert/strict'
import { MarketClient } from '../dist/client.js'

const client = new MarketClient(), signal = AbortSignal.timeout(45_000)
const output = { status: await client.status(), checks: [] }
async function check(market, symbol) {
  const quote = await client.quote({ market, symbol }, signal)
  assert.ok(quote.price > 0)
  const bars = await client.candles({ market, symbol, interval: '1h', limit: 10 }, signal)
  assert.ok(bars.candles.length > 0)
  output.checks.push({ market, symbol: quote.symbol, provider: quote.provider, feed: quote.feed, sourceAt: quote.sourceAt, stale: quote.stale, candles: bars.candles.length })
}
await check('crypto', 'BTC')
if (output.status.us.configured) await check('us', 'AAPL')
else output.stockLiveCheck = 'skipped: Alpaca credentials not configured'
console.log(JSON.stringify(output, null, 2))
