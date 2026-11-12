import type { Candles } from './types.js';
/** A self-contained snapshot; neither credentials nor network requests reach the browser. */
export declare function renderInteractiveChart(data: Candles): Promise<string>;
