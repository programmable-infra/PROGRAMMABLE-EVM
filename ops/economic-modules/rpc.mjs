import { setTimeout as wait } from "node:timers/promises";
import { http } from "viem";

class EconomicRpcError extends Error {
  constructor(reason, retryAfterMs) {
    super(reason);
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

// Only these fields may cross into health/log output. Provider errors can contain credentials.
export function economicRpcFailure(error) {
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (current instanceof EconomicRpcError) return { reason: current.reason, retryAfterMs: current.retryAfterMs };
    if (current.name === "TimeoutError") return { reason: "rpc-timeout", retryAfterMs: 60_000 };
  }
  return { reason: "pass-failed", retryAfterMs: 60_000 };
}

function retryDelay(value) {
  const milliseconds = /^\d+(\.\d+)?$/.test(value ?? "") ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(60_000, milliseconds) : 60_000;
}

const reads = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getCode", "eth_call", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getLogs",
  "eth_getBalance", "eth_getStorageAt", "eth_getTransactionCount", "eth_estimateGas", "eth_gasPrice",
  "eth_maxPriorityFeePerGas", "eth_feeHistory", "debug_traceTransaction"]);

/** Serialize requests to each existing provider, without replaying writes or changing providers. */
export function economicHttp(url, { intervalMs = 350, timeout = 60_000, signal, maxRateRetries = 2 } = {}) {
  return options => {
    let tail = Promise.resolve(), lastStarted = 0, cooldownUntil = 0;
    const base = http(url, { retryCount: 0, timeout, async onFetchResponse(response) {
      if (response.status === 429) {
        await response.body?.cancel();
        const delay = retryDelay(response.headers.get("retry-after"));
        cooldownUntil = Date.now() + delay;
        throw new EconomicRpcError("rpc-rate-limited", delay);
      }
      if ([401, 403].includes(response.status)) {
        await response.body?.cancel();
        throw new EconomicRpcError("rpc-access-denied", 60_000);
      }
    } })({ ...options, timeout });
    return { ...base, request(...args) {
      const pending = tail.then(async () => {
        for (let attempt = 0; ; attempt++) {
          signal?.throwIfAborted();
          const cooldown = cooldownUntil - Date.now();
          if (cooldown > 0 && (!reads.has(args[0].method) || maxRateRetries === 0)) throw new EconomicRpcError("rpc-rate-limited", cooldown);
          await wait(Math.max(0, cooldown, lastStarted + intervalMs - Date.now()), undefined, { signal });
          lastStarted = Date.now();
          try {
            // Supplying a signal replaces viem's internal timeout; retain both bounds explicitly.
            return await base.request(args[0], signal ? { ...args[1], signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) } : args[1]);
          } catch (error) {
            if (!reads.has(args[0].method) || attempt >= maxRateRetries || economicRpcFailure(error).reason !== "rpc-rate-limited") throw error;
          }
        }
      });
      tail = pending.catch(() => {});
      return pending;
    } };
  };
}
