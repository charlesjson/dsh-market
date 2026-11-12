import type { Candles } from './types.js';
/** Standalone SVG with embedded provenance; no scripts or third-party resources. */
export declare function renderChart(data: Candles): string;
export declare function renderCsv(data: Candles): string;
/** Raster preview for the host's inline Markdown image renderer. */
export declare function renderChartPng(svg: string, signal: AbortSignal): Promise<Uint8Array>;
