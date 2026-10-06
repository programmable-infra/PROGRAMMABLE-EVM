import type { Transport } from "viem";
export function economicHttp(url: string, options?: { intervalMs?: number; timeout?: number; signal?: AbortSignal; maxRateRetries?: number }): Transport;
export function economicRpcFailure(error: unknown): { reason: string; retryAfterMs: number };
