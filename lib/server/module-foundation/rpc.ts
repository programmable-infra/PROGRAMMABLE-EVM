import "server-only";
import type { Hex } from "viem";
import { productionMainnetRpcPair } from "@/lib/onchain/website-rpc-providers.server";
import { TradeRpcExecutionRevertedV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

/** Two existing, independently operated Ethereum providers. Never expose their URLs in errors. */
export function foundationMainnetRpcs(env: Readonly<Record<string, string | undefined>> = process.env, fetcher: typeof fetch = fetch): readonly [TradeRpcV1, TradeRpcV1] {
  const pair = productionMainnetRpcPair(env);
  const transport = (endpoint: string): TradeRpcV1 => async (method, params) => {
    try {
      const response = await fetcher(endpoint, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > 1_048_576) throw new Error();
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break;
        size += part.value.length; if (size > 1_048_576) throw new Error(); chunks.push(part.value);
      } } finally { await reader.cancel().catch(() => undefined); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || data.jsonrpc !== "2.0" || data.id !== 1) throw new Error();
      if (method === "eth_call" && data.error?.code === 3 && !Object.hasOwn(data, "result")
        && typeof data.error.message === "string" && /^execution reverted\b/i.test(data.error.message)
        && typeof data.error.data === "string" && /^0x(?:[0-9a-f]{2}){0,32768}$/i.test(data.error.data)) {
        throw new TradeRpcExecutionRevertedV1(data.error.data.toLowerCase() as Hex);
      }
      if (data.error || !Object.hasOwn(data, "result")) throw new Error();
      return data.result;
    } catch (error) {
      if (error instanceof TradeRpcExecutionRevertedV1) throw error;
      throw new Error("An Ethereum provider is temporarily unavailable.");
    }
  };
  return [transport(pair.primary.url), transport(pair.secondary.url)];
}
