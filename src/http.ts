import type { Config } from './config.js'

export class MarketError extends Error {
  constructor(message: string, public readonly status?: number, public readonly retryAfterSeconds?: number) { super(message) }
}
export type Fetcher = typeof fetch

/** Fixed provider origins, bounded body, no redirects, cancellation through body reads. */
export async function getJson(url: URL, headers: Record<string, string>, config: Config, caller: AbortSignal, fetcher: Fetcher): Promise<unknown> {
  caller.throwIfAborted()
  const signal = AbortSignal.any([caller, AbortSignal.timeout(config.timeoutMs)])
  let response: Response
  try {
    response = await fetcher(url, { method: 'GET', headers: { accept: 'application/json', ...headers }, redirect: 'error', signal })
  } catch {
    caller.throwIfAborted()
    if (signal.aborted) throw new MarketError('行情请求超时')
    throw new MarketError(`无法连接 ${url.hostname}；请检查网络或数据源所在地区的可用性`)
  }
  if (!response.ok) {
    await response.body?.cancel()
    const retry = Number(response.headers.get('retry-after'))
    const seconds = Number.isFinite(retry) && retry > 0 ? retry : undefined
    const hint = response.status === 429 || response.status === 418 ? '数据源限流，请稍后重试'
      : response.status === 401 ? 'Alpaca 密钥无效'
      : response.status === 403 ? '数据源拒绝访问，请检查地区限制、Key 和行情订阅权限'
      : response.status === 451 ? '数据源在当前地区不可用'
      : response.status === 400 || response.status === 404 ? '数据源不接受该代码或查询参数'
      : '行情服务暂不可用'
    throw new MarketError(`${hint}（HTTP ${response.status}）`, response.status, seconds)
  }
  if (Number(response.headers.get('content-length')) > config.maxResponseBytes) {
    await response.body?.cancel()
    throw new MarketError('行情响应超过大小上限')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new MarketError('行情响应为空')
  const chunks: Uint8Array[] = []
  let size = 0
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      size += value.byteLength
      if (size > config.maxResponseBytes) throw new MarketError('行情响应超过大小上限')
      chunks.push(value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new MarketError('行情源返回了无效 JSON') }
  } catch (error) {
    await reader.cancel().catch(() => {})
    caller.throwIfAborted()
    if (signal.aborted) throw new MarketError('行情请求超时')
    if (error instanceof MarketError) throw error
    throw new MarketError('读取行情响应失败')
  } finally {
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}
