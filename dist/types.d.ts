export type Market = 'crypto' | 'us';
export interface Instrument {
    market: Market;
    symbol: string;
}
export interface Provenance {
    provider: 'binance' | 'alpaca';
    feed: string;
    coverage: string;
    delaySeconds: number;
    fetchedAt: string;
}
export interface Quote extends Instrument, Provenance {
    currency: string;
    price: number | null;
    sourceAt: string | null;
    ageSeconds: number | null;
    stale: boolean;
    bid: number | null;
    ask: number | null;
    quoteAt: string | null;
    change: number | null;
    changePercent: number | null;
    changeBasis: 'rolling_24h' | 'previous_daily_close';
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
    volumeAt: string | null;
    statisticsWindowEnd: string | null;
}
export interface Candle {
    time: string;
    endTime: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closed: boolean;
}
export interface Candles extends Instrument, Provenance {
    currency: string;
    interval: string;
    adjustment: 'raw';
    timezone: 'UTC' | 'America/New_York';
    candles: Candle[];
    requestedLimit: number;
    hasMore: boolean;
    nextPageToken: string | null;
    rangeStart: string | null;
    rangeEnd: string | null;
}
