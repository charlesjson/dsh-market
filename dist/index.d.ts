import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-system-prompt';
import type { Config } from './config.js';
export { Config } from './config.js';
export { MarketClient } from './client.js';
export declare const name = "market";
export declare const inject: string[];
export declare function apply(ctx: Context, config?: Partial<Config>): void;
