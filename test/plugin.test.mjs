import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as MarketPlugin from '../dist/index.js'

async function harness(t, withAttachments = false) {
  const ctx = new Context(), sections = new Map(), files = []
  class Prompts extends Service {
    constructor(ctx) { super(ctx, 'systemPrompt') }
    tools() {}
    section(section) { sections.set(section.name, section); this.ctx.effect(() => () => sections.delete(section.name)) }
  }
  class Attachments extends Service {
    constructor(ctx) { super(ctx, 'attachments') }
    async saveFileStream({ data, name, signal }) {
      const chunks = []
      for await (const chunk of data) { signal.throwIfAborted(); chunks.push(chunk) }
      const bytes = Buffer.concat(chunks)
      files.push({ name, bytes })
      return { attachmentId: createHash('sha256').update(bytes).digest('hex'), name, bytes: bytes.byteLength }
    }
  }
  await ctx.plugin(Prompts)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeExecutor)
  if (withAttachments) await ctx.plugin(Attachments)
  const fork = ctx.plugin(MarketPlugin, { connectionFile: '/missing-market-test', timeoutMs: 1000 })
  await fork
  t.after(() => ctx.fiber.dispose())
  return { ctx, fork, sections, files }
}

const execute = async (ctx, name, args, signal = new AbortController().signal) => {
  const batch = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: 'market-fixture', name, arguments: JSON.stringify(args) }], signal })
  return batch.results[0].result
}

test('real Harness runtime registers tools, executes crypto query, validates input and disposes effects', async t => {
  const { ctx, fork, sections } = await harness(t)
  assert.equal(ctx.tools.schemas().filter(x => x.name.startsWith('market_')).length, 5)
  assert.match(sections.get('tool:market').text({}), /IEX|iex/)
  t.mock.method(globalThis, 'fetch', async url => Response.json(new URL(url).pathname.endsWith('/trades') ? [{ price: '110', time: Date.now() }] : { openPrice: '100', highPrice: '120', lowPrice: '90', volume: '10', closeTime: Date.now() }))
  const result = await execute(ctx, 'market_quote', { instruments: [{ market: 'crypto', symbol: 'BTC' }] })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.match(JSON.stringify(result), /BTCUSDT/)
  const invalid = await execute(ctx, 'market_quote', { instruments: [{ market: 'bad', symbol: 'BTC' }] })
  assert.equal(invalid.isError, true)
  await fork.dispose()
  assert.equal(ctx.tools.schemas().filter(x => x.name.startsWith('market_')).length, 0)
  assert.equal(sections.size, 0)
})

test('native chart tool saves SVG and CSV and projects durable file content', async t => {
  const { ctx, files } = await harness(t, true)
  assert.ok(ctx.tools.get('market_chart'))
  const time = Date.now() - 3600_000
  t.mock.method(globalThis, 'fetch', async () => Response.json([[time, '100', '120', '90', '110', '1000', time + 3600_000 - 1]]))
  const result = await execute(ctx, 'market_chart', { market: 'crypto', symbol: 'BTC', interval: '1h' })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(files.length, 2)
  assert.equal(files[0].name, 'BTCUSDT-1h.svg')
  assert.match(files[0].bytes.toString(), /<svg/)
  assert.equal(files[1].name, 'BTCUSDT-1h.csv')
  assert.equal(result.content.filter(x => x.type === 'file').length, 2)
})

test('plugin disposal cancels an in-flight provider request', async t => {
  const { ctx, fork } = await harness(t)
  let started
  const ready = new Promise(resolve => { started = resolve })
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    started()
    return new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(init.signal.reason)
      else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })
  })
  const pending = execute(ctx, 'market_quote', { instruments: [{ market: 'crypto', symbol: 'BTC' }] })
  await ready
  await fork.dispose()
  const result = await pending
  assert.equal(result.isError, true)
})
