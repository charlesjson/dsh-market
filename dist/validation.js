export function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('预期 JSON 对象');
    return value;
}
export function text(value, label) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${label} 必须为非空字符串`);
    return value.trim();
}
export function integer(value, fallback, min, max, label) {
    const n = value === undefined ? fallback : value;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max)
        throw new Error(`${label} 必须为 ${min}–${max} 的整数`);
    return n;
}
export function numeric(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || value === '')
        throw new Error('行情源数值字段缺失');
    const n = Number(value);
    if (!Number.isFinite(n))
        throw new Error('行情源数值字段无效');
    return n;
}
export function optionalNumber(value) { return value === undefined || value === null ? null : numeric(value); }
export function timestamp(value) {
    const ms = typeof value === 'number' ? value : Date.parse(String(value));
    if (!Number.isFinite(ms) || ms < 0)
        throw new Error('行情源时间字段无效');
    return new Date(ms).toISOString();
}
export function optionalTime(value) { return value === undefined || value === null ? null : timestamp(value); }
export function dateArgument(value, label) {
    if (value === undefined)
        return undefined;
    const raw = text(value, label);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw)))
        throw new Error(`${label} 需要含时区的 RFC3339 时间，例如 2026-11-01T00:00:00Z`);
    return new Date(raw).toISOString();
}
export function instrument(value) {
    const args = record(value);
    if (args.market !== 'crypto' && args.market !== 'us')
        throw new Error('market 只支持 crypto 或 us；请明确市场，避免 BTC 等代码歧义');
    const market = args.market;
    let symbol = text(args.symbol, 'symbol').toUpperCase();
    if (market === 'crypto') {
        if (!/^[A-Z0-9]{2,25}(?:[/-][A-Z0-9]{2,10})?$/.test(symbol))
            throw new Error('加密货币代码格式无效，例如 BTC、BTCUSDT、BTC/USDT');
        const paired = /[/-]/.test(symbol);
        symbol = symbol.replace(/[/-]/g, '');
        if (!paired && !['USDT', 'USDC', 'FDUSD', 'TUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'USD', 'DAI', 'BRL', 'JPY'].some(q => symbol.length > q.length && symbol.endsWith(q)))
            symbol += 'USDT';
    }
    else if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol))
        throw new Error('美股代码格式无效，例如 AAPL、NVDA、BRK.B');
    return { market, symbol };
}
export function instruments(value, max = 10) {
    if (!Array.isArray(value) || value.length < 1 || value.length > max)
        throw new Error(`instruments 需要 1–${max} 个市场和代码对象`);
    return [...new Map(value.map(v => { const i = instrument(v); return [`${i.market}:${i.symbol}`, i]; })).values()];
}
