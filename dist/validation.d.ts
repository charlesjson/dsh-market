import type { Instrument } from './types.js';
export declare function record(value: unknown): Record<string, unknown>;
export declare function text(value: unknown, label: string): string;
export declare function integer(value: unknown, fallback: number, min: number, max: number, label: string): number;
export declare function numeric(value: unknown): number;
export declare function optionalNumber(value: unknown): number | null;
export declare function timestamp(value: unknown): string;
export declare function optionalTime(value: unknown): string | null;
export declare function dateArgument(value: unknown, label: string): string | undefined;
export type ParsedInstrument = Instrument & {
    currency: string;
};
export declare function instrument(value: unknown): ParsedInstrument;
export declare function instruments(value: unknown, max?: number): ParsedInstrument[];
