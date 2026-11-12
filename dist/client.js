import { setTimeout as pause } from 'node:timers/promises';
import { loadConnection, resolveConfig } from './config.js';
import { getJson, MarketError } from './http.js';
import { dateArgument, instrument, instruments, integer, numeric, optionalNumber, optionalTime, record, text, timestamp } from './validation.js';
const BINANCE = 'https://data-api.binance.vision';
const ALPACA = 'https://data.alpaca.markets';
const cryptoIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
const stockIntervals = { '1m': '1Min', '5m': '5Min', '15m': '15Min', '30m': '30Min', '1h': '1Hour', '4h': '4Hour', '1d': '1Day', '1w': '1Week', '1M': '1Month' };
const DAY = 86400_000;
function provenance(i, connection, now) {
    return {
        provider: i.market === 'crypto' ? 'binance' : 'alpaca',
        feed: i.market === 'crypto' ? 'spot' : connection.feed,
        coverage: i.market === 'crypto' ? 'Binance 现货，交易对计价币种' : connection.feed === 'iex' ? 'IEX 单一交易所，非全美市场' : '全美交易所 SIP',
        delaySeconds: i.market === 'us' && connection.feed === 'delayed_sip' ? 900 : 0,
        fetchedAt: new Date(now).toISOString(),
    };
}
function quoteCurrency(symbol) {
    return ['FDUSD', 'USDT', 'USDC', 'TUSD', 'DAI', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'USD', 'BRL', 'JPY'].find(q => symbol.length > q.length && symbol.endsWith(q)) ?? 'UNKNOWN';
}
function optionalRecord(value) { return value == null ? {} : record(value); }
function age(sourceAt, now, threshold) {
    const ageSeconds = sourceAt === null ? null : Math.max(0, (now - Date.parse(sourceAt)) / 1000);
    return { ageSeconds, stale: ageSeconds === null || ageSeconds > threshold };
}
function validateCandle(c) {
    if (c.volume < 0 || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) || c.high < c.low)
        throw new Error('行情源 OHLCV 数据不一致');
    return c;
}
/** Calendar bar boundaries in the exchange timezone, including DST transitions. */
export function candleEnd(time, interval, timezone) {
    const start = Date.parse(time);
    const count = Number.parseInt(interval, 10), unit = interval.slice(-1);
    if (unit === 'm' || unit === 'h')
        return new Date(start + count * (unit === 'm' ? 60_000 : 3600_000)).toISOString();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const local = (ms) => {
        const p = Object.fromEntries(formatter.formatToParts(ms).map(x => [x.type, x.value]));
        return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    };
    const target = new Date(local(start));
    if (unit === 'M')
        target.setUTCMonth(target.getUTCMonth() + count);
    else
        target.setUTCDate(target.getUTCDate() + count * (unit === 'w' ? 7 : 1));
    let guess = target.getTime();
    for (let n = 0; n < 3; n++)
        guess += target.getTime() - local(guess);
    return new Date(guess).toISOString();
}
export class MarketClient {
    fetcher;
    now;
    config;
    constructor(config = {}, fetcher = (...args) => globalThis.fetch(...args), now = Date.now) {
        this.fetcher = fetcher;
        this.now = now;
        this.config = resolveConfig(config);
    }
    async connection(i) {
        // A broken stock configuration must not prevent anonymous crypto queries.
        if (i.market === 'crypto')
            return { feed: 'iex' };
        const connection = await loadConnection(this.config.connectionFile);
        if (!connection.keyId || !connection.secretKey)
            throw new MarketError('美股行情需要 Alpaca Key：设置 APCA_API_KEY_ID / APCA_API_SECRET_KEY，或 ~/.config/dsh-market/connection.json（keyId、secretKey、feed）。加密货币无需 Key。');
        return connection;
    }
    request(origin, path, params, connection, signal) {
        const url = new URL(path, origin);
        for (const [key, value] of Object.entries(params))
            if (value !== undefined)
                url.searchParams.set(key, String(value));
        const headers = {};
        if (origin === ALPACA && connection.keyId && connection.secretKey) {
            headers['APCA-API-KEY-ID'] = connection.keyId;
            headers['APCA-API-SECRET-KEY'] = connection.secretKey;
        }
        return getJson(url, headers, this.config, signal, this.fetcher);
    }
    async status() {
        const c = await loadConnection(this.config.connectionFile);
        return { crypto: { provider: 'binance', configured: true, requiresKey: false }, us: { provider: 'alpaca', configured: Boolean(c.keyId && c.secretKey), feed: c.feed, delaySeconds: c.feed === 'delayed_sip' ? 900 : 0, coverage: c.feed === 'iex' ? 'IEX 单一交易所' : '全美交易所 SIP' }, transport: '按需 REST 查询；watch 为有界轮询，结果在采样结束后返回', verifiedConnectivity: false };
    }
    async quote(input, signal) {
        const i = instrument(input), c = await this.connection(i);
        signal.throwIfAborted();
        if (i.market === 'crypto') {
            // Actual trade time prevents a fresh 24h statistics window from hiding an idle market.
            const responses = await Promise.allSettled([
                this.request(BINANCE, '/api/v3/ticker/24hr', { symbol: i.symbol }, c, signal),
                this.request(BINANCE, '/api/v3/trades', { symbol: i.symbol, limit: 1 }, c, signal),
            ]);
            signal.throwIfAborted();
            const values = responses.map(r => { if (r.status === 'rejected')
                throw r.reason; return r.value; });
            const ticker = record(values[0]), trades = values[1];
            if (!Array.isArray(trades) || !trades.length)
                throw new MarketError('该交易对没有成交数据');
            const trade = record(trades[0]), sourceAt = timestamp(trade.time), now = this.now();
            const price = numeric(trade.price), open = numeric(ticker.openPrice), change = price - open;
            return { ...i, ...provenance(i, c, now), currency: quoteCurrency(i.symbol), price, sourceAt,
                ...age(sourceAt, now, this.config.staleAfterSeconds), bid: optionalNumber(ticker.bidPrice), ask: optionalNumber(ticker.askPrice),
                quoteAt: null, change, changePercent: open ? change / open * 100 : null, changeBasis: 'rolling_24h',
                open, high: numeric(ticker.highPrice), low: numeric(ticker.lowPrice), volume: numeric(ticker.volume),
                volumeAt: timestamp(ticker.closeTime), statisticsWindowEnd: timestamp(ticker.closeTime) };
        }
        const snapshot = record(await this.request(ALPACA, `/v2/stocks/${encodeURIComponent(i.symbol)}/snapshot`, { feed: c.feed }, c, signal));
        const trade = optionalRecord(snapshot.latestTrade), book = optionalRecord(snapshot.latestQuote);
        const daily = optionalRecord(snapshot.dailyBar), previous = optionalRecord(snapshot.prevDailyBar);
        const now = this.now(), sourceAt = optionalTime(trade.t), price = optionalNumber(trade.p), prev = optionalNumber(previous.c);
        const change = price !== null && prev !== null ? price - prev : null;
        return { ...i, ...provenance(i, c, now), currency: 'USD', price, sourceAt,
            ...age(sourceAt, now, this.config.staleAfterSeconds), bid: optionalNumber(book.bp), ask: optionalNumber(book.ap), quoteAt: optionalTime(book.t),
            change, changePercent: change !== null && prev ? change / prev * 100 : null, changeBasis: 'previous_daily_close',
            open: optionalNumber(daily.o), high: optionalNumber(daily.h), low: optionalNumber(daily.l), volume: optionalNumber(daily.v),
            volumeAt: optionalTime(daily.t), statisticsWindowEnd: null };
    }
    async quotes(input, signal) {
        const items = instruments(record(input).instruments);
        const results = await Promise.allSettled(items.map(i => this.quote(i, signal)));
        signal.throwIfAborted();
        return {
            quotes: results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []),
            errors: results.flatMap((r, n) => r.status === 'rejected' ? [{ ...items[n], message: this.errorMessage(r.reason), retryAfterSeconds: r.reason instanceof MarketError ? r.reason.retryAfterSeconds ?? null : null }] : []),
            complete: results.every(r => r.status === 'fulfilled'),
        };
    }
    errorMessage(error) { return error instanceof Error ? error.message : '行情请求失败'; }
    async candles(input, signal) {
        const args = record(input), i = instrument(args), interval = args.interval === undefined ? '1h' : text(args.interval, 'interval');
        if (!(i.market === 'crypto' ? cryptoIntervals.includes(interval) : interval in stockIntervals))
            throw new Error(`不支持该周期；可选：${i.market === 'crypto' ? cryptoIntervals.join(', ') : Object.keys(stockIntervals).join(', ')}`);
        const limit = integer(args.limit, 100, 1, 1000, 'limit');
        const start = dateArgument(args.start, 'start'), end = dateArgument(args.end, 'end');
        if (start && end && start >= end)
            throw new Error('start 必须早于 end');
        const pageToken = args.pageToken === undefined ? undefined : text(args.pageToken, 'pageToken');
        if (pageToken && (i.market !== 'us' || pageToken.length > 4096))
            throw new Error('pageToken 仅适用于美股，最长 4096 字符');
        if (pageToken && (!start || !end))
            throw new Error('美股翻页必须同时传入上一页返回的 rangeStart 和 rangeEnd，避免窗口漂移');
        const c = await this.connection(i);
        let rows, nextPageToken = null, hasMore = false;
        let rangeStart = start ?? null, rangeEnd = end ?? null;
        if (i.market === 'crypto') {
            const data = await this.request(BINANCE, '/api/v3/klines', { symbol: i.symbol, interval, limit, startTime: start ? Date.parse(start) : undefined, endTime: end ? Date.parse(end) - 1 : undefined }, c, signal);
            if (!Array.isArray(data))
                throw new Error('行情源 K 线格式无效');
            rows = data;
            hasMore = rows.length === limit;
        }
        else {
            const delayed = c.feed === 'delayed_sip';
            // REST bars use sip + end cutoff for delayed subscriptions, not delayed_sip.
            const cutoff = this.now() - (delayed ? 900_000 : 0);
            const until = end ? Math.min(Date.parse(end), cutoff) : cutoff;
            if (start && Date.parse(start) >= until)
                throw new Error('所选时间范围尚无可访问数据；delayed_sip 最近 15 分钟不可用');
            rangeStart = start ?? new Date(until - this.lookback(interval, limit)).toISOString();
            rangeEnd = new Date(until).toISOString();
            const data = record(await this.request(ALPACA, '/v2/stocks/bars', {
                symbols: i.symbol, timeframe: stockIntervals[interval], limit, feed: delayed ? 'sip' : c.feed,
                start: rangeStart,
                end: rangeEnd, adjustment: 'raw', sort: 'desc', page_token: pageToken,
            }, c, signal));
            const bySymbol = optionalRecord(data.bars), values = bySymbol[i.symbol];
            if (values !== null && values !== undefined && !Array.isArray(values))
                throw new Error('行情源 K 线格式无效');
            rows = values ?? [];
            nextPageToken = data.next_page_token == null ? null : text(data.next_page_token, 'next_page_token');
            hasMore = nextPageToken !== null;
        }
        const now = this.now();
        const candles = rows.map(row => {
            if (i.market === 'crypto') {
                if (!Array.isArray(row) || row.length < 7)
                    throw new Error('行情源 K 线格式无效');
                const time = timestamp(row[0]), endTime = timestamp(numeric(row[6]) + 1);
                return validateCandle({ time, endTime, open: numeric(row[1]), high: numeric(row[2]), low: numeric(row[3]), close: numeric(row[4]), volume: numeric(row[5]), closed: Date.parse(endTime) <= now });
            }
            const bar = record(row), time = timestamp(bar.t), endTime = candleEnd(time, interval, 'America/New_York');
            return validateCandle({ time, endTime, open: numeric(bar.o), high: numeric(bar.h), low: numeric(bar.l), close: numeric(bar.c), volume: numeric(bar.v), closed: Date.parse(endTime) <= now - (c.feed === 'delayed_sip' ? 900_000 : 0) });
        }).sort((a, b) => a.time.localeCompare(b.time));
        signal.throwIfAborted();
        return { ...i, ...provenance(i, c, now), currency: i.market === 'us' ? 'USD' : quoteCurrency(i.symbol), interval, adjustment: 'raw', timezone: i.market === 'us' ? 'America/New_York' : 'UTC', candles, requestedLimit: limit, hasMore, nextPageToken, rangeStart, rangeEnd };
    }
    lookback(interval, limit) {
        const factor = interval.endsWith('m') ? Number.parseInt(interval) / 390 : interval.endsWith('h') ? Number.parseInt(interval) / 6.5 : interval === '1w' ? 7 : interval === '1M' ? 31 : 1;
        // Include weekends, holidays and sparse IEX sessions. This remains a bounded window.
        return Math.max(10 * DAY, Math.ceil(limit * factor * 2.5 + 7) * DAY);
    }
    async orderbook(input, signal) {
        const args = record(input), i = instrument(args);
        if (i.market !== 'crypto')
            throw new Error('多档盘口仅支持 Binance 加密货币现货；美股买一卖一请调用 market_quote');
        const limit = integer(args.limit, 20, 1, 100, 'limit'), c = await this.connection(i);
        const data = record(await this.request(BINANCE, '/api/v3/depth', { symbol: i.symbol, limit }, c, signal));
        const levels = (value) => {
            if (!Array.isArray(value))
                throw new Error('行情源盘口格式无效');
            return value.slice(0, limit).map(row => {
                if (!Array.isArray(row))
                    throw new Error('行情源盘口格式无效');
                return { price: numeric(row[0]), quantity: numeric(row[1]) };
            });
        };
        const bids = levels(data.bids), asks = levels(data.asks);
        return { ...i, ...provenance(i, c, this.now()), currency: quoteCurrency(i.symbol), sourceAt: null, timestampNote: 'REST 盘口未提供交易所时间；fetchedAt 仅是本机接收时间', lastUpdateId: numeric(data.lastUpdateId), bids, asks, spread: bids.length && asks.length ? asks[0].price - bids[0].price : null };
    }
    async watch(input, caller) {
        const args = record(input), items = instruments(args.instruments, 5);
        const samples = integer(args.samples, 3, 2, 12, 'samples'), intervalSeconds = integer(args.intervalSeconds, 5, 2, 30, 'intervalSeconds');
        if ((samples - 1) * intervalSeconds > 60)
            throw new Error('采样间隔总计不能超过 60 秒');
        const deadline = AbortSignal.timeout(75_000), signal = AbortSignal.any([caller, deadline]);
        const snapshots = [];
        try {
            for (let n = 0; n < samples; n++) {
                if (n)
                    await pause(intervalSeconds * 1000, undefined, { signal });
                snapshots.push({ sampledAt: new Date(this.now()).toISOString(), ...await this.quotes({ instruments: items }, signal) });
                // Fail fast on rate limits/missing credentials instead of multiplying failures.
                if (snapshots.at(-1).errors.length)
                    break;
            }
        }
        catch (error) {
            caller.throwIfAborted();
            if (!deadline.aborted)
                throw error;
            return { mode: 'polling', complete: false, requestedSamples: samples, intervalSeconds, snapshots, stoppedReason: '达到 75 秒总时限' };
        }
        return { mode: 'polling', complete: snapshots.length === samples && snapshots.every(s => s.complete), requestedSamples: samples, intervalSeconds, snapshots, stoppedReason: snapshots.some(s => !s.complete) ? '数据源返回错误，已停止后续轮询' : null };
    }
}
