import z from '@deepseek-ai/schemastery'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Config {
  connectionFile: string
  timeoutMs: number
  maxResponseBytes: number
  staleAfterSeconds: number
}
export const defaults: Config = {
  connectionFile: join(homedir(), '.config/dsh-market/connection.json'),
  timeoutMs: 15_000,
  maxResponseBytes: 2 * 1024 * 1024,
  staleAfterSeconds: 120,
}
export const Config: z<Config> = z.object({
  connectionFile: z.string().default(defaults.connectionFile),
  timeoutMs: z.number().default(defaults.timeoutMs),
  maxResponseBytes: z.number().default(defaults.maxResponseBytes),
  staleAfterSeconds: z.number().default(defaults.staleAfterSeconds),
})
export function resolveConfig(config: Partial<Config> = {}): Config {
  const value = { ...defaults, ...config }
  for (const [key, min, max] of [
    ['timeoutMs', 100, 60_000], ['maxResponseBytes', 1024, 16 * 1024 * 1024],
    ['staleAfterSeconds', 1, 86400],
  ] as const) {
    if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) throw new Error(`dsh-market: ${key} 必须为 ${min}–${max} 的整数`)
  }
  if (typeof value.connectionFile !== 'string' || !value.connectionFile) throw new Error('dsh-market: connectionFile 不能为空')
  return value
}

export type StockFeed = 'iex' | 'sip' | 'delayed_sip'
export interface Connection { keyId?: string; secretKey?: string; feed: StockFeed }

/** Read on each call so rotating credentials does not require a host restart. */
export async function loadConnection(file: string): Promise<Connection> {
  let stored: Record<string, unknown> = {}
  try {
    const info = await stat(file)
    if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('dsh-market: 连接文件权限过宽，请 chmod 600 配置文件')
    if (info.size > 16_384) throw new Error('dsh-market: 连接文件超过 16 KiB')
    let parsed: unknown
    try { parsed = JSON.parse(await readFile(file, 'utf8')) } catch { throw new Error('dsh-market: 连接文件不是有效 JSON') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('dsh-market: 连接文件必须是 JSON 对象')
    stored = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const keyId = process.env.APCA_API_KEY_ID ?? stored.keyId
  const secretKey = process.env.APCA_API_SECRET_KEY ?? stored.secretKey
  const feed = process.env.DSH_MARKET_STOCK_FEED ?? stored.feed ?? 'iex'
  if (!['iex', 'sip', 'delayed_sip'].includes(String(feed))) throw new Error('dsh-market: feed 只支持 iex、sip、delayed_sip')
  for (const key of [keyId, secretKey]) {
    if (key !== undefined && (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key))) throw new Error('dsh-market: Alpaca 密钥配置无效')
  }
  if (Boolean(keyId) !== Boolean(secretKey)) throw new Error('dsh-market: Alpaca keyId 和 secretKey 必须同时设置')
  return { keyId: keyId as string | undefined, secretKey: secretKey as string | undefined, feed: feed as StockFeed }
}
