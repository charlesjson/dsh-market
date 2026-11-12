import type { Config } from './config.js';
export declare class MarketError extends Error {
    readonly status?: number | undefined;
    readonly retryAfterSeconds?: number | undefined;
    constructor(message: string, status?: number | undefined, retryAfterSeconds?: number | undefined);
}
export type Fetcher = typeof fetch;
/** Fixed provider origins, bounded body, no redirects, cancellation through body reads. */
export declare function getJson(url: URL, headers: Record<string, string>, config: Config, caller: AbortSignal, fetcher: Fetcher): Promise<unknown>;
