import z from '@deepseek-ai/schemastery';
export interface Config {
    connectionFile: string;
    timeoutMs: number;
    maxResponseBytes: number;
    staleAfterSeconds: number;
}
export declare const defaults: Config;
export declare const Config: z<Config>;
export declare function resolveConfig(config?: Partial<Config>): Config;
export type StockFeed = 'iex' | 'sip' | 'delayed_sip';
export interface Connection {
    keyId?: string;
    secretKey?: string;
    feed: StockFeed;
}
/** Read on each call so rotating credentials does not require a host restart. */
export declare function loadConnection(file: string): Promise<Connection>;
