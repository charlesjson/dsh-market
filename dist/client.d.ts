import { type Config } from './config.js';
import { type Fetcher } from './http.js';
import type { Candles, Quote } from './types.js';
/** Calendar bar boundaries in the exchange timezone, including DST transitions. */
export declare function candleEnd(time: string, interval: string, timezone: string): string;
export declare class MarketClient {
    private readonly fetcher;
    private readonly now;
    readonly config: Config;
    constructor(config?: Partial<Config>, fetcher?: Fetcher, now?: () => number);
    private connection;
    private request;
    status(): Promise<{
        crypto: {
            provider: string;
            configured: boolean;
            requiresKey: boolean;
        };
        us: {
            provider: string;
            configured: boolean;
            feed: import("./config.js").StockFeed;
            delaySeconds: number;
            coverage: string;
        };
        transport: string;
        verifiedConnectivity: boolean;
    }>;
    quote(input: unknown, signal: AbortSignal): Promise<Quote>;
    quotes(input: unknown, signal: AbortSignal): Promise<{
        quotes: Quote[];
        errors: {
            message: string;
            retryAfterSeconds: number | null;
            market: import("./types.js").Market;
            symbol: string;
        }[];
        complete: boolean;
    }>;
    errorMessage(error: unknown): string;
    candles(input: unknown, signal: AbortSignal): Promise<Candles>;
    private lookback;
    orderbook(input: unknown, signal: AbortSignal): Promise<{
        currency: string;
        sourceAt: null;
        timestampNote: string;
        lastUpdateId: number;
        bids: {
            price: number;
            quantity: number;
        }[];
        asks: {
            price: number;
            quantity: number;
        }[];
        spread: number | null;
        provider: "binance" | "alpaca";
        feed: string;
        coverage: string;
        delaySeconds: number;
        fetchedAt: string;
        market: import("./types.js").Market;
        symbol: string;
    }>;
    watch(input: unknown, caller: AbortSignal): Promise<{
        mode: string;
        complete: boolean;
        requestedSamples: number;
        intervalSeconds: number;
        snapshots: {
            quotes: Quote[];
            errors: {
                message: string;
                retryAfterSeconds: number | null;
                market: import("./types.js").Market;
                symbol: string;
            }[];
            complete: boolean;
            sampledAt: string;
        }[];
        stoppedReason: string | null;
    }>;
}
