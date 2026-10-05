import "server-only";
import { rpcProviderCommitment } from "@/lib/data-pipeline/rpc-provider-commitments";
import type { TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

/** Discovery only. Results grant no authority until both production RPCs verify the logs. */
export function foundationMainnetPoolHints(env: Readonly<Record<string, string | undefined>> = process.env, fetcher: typeof fetch = fetch): TradeRpcV1 | undefined {
  const endpoint = env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL;
  if (!endpoint) return undefined;
  const url = new URL(endpoint), commitment = env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT;
  if (url.protocol !== "https:" || url.hostname !== "eth-mainnet.g.alchemy.com" || url.port || url.username || url.password || url.search || url.hash
    || !/^\/v2\/[A-Za-z0-9_-]{8,256}$/.test(url.pathname)
    || (commitment && rpcProviderCommitment("endpoint", endpoint) !== commitment)) {
    throw new Error("The Ethereum pool discovery configuration is invalid.");
  }
  return async (method, params) => {
    try {
      if (method !== "eth_getLogs") throw new Error();
      const response = await fetcher(endpoint, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > 1_048_576) throw new Error();
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break;
        size += part.value.length; if (size > 1_048_576) throw new Error(); chunks.push(part.value);
      } } finally { await reader.cancel().catch(() => undefined); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || data.jsonrpc !== "2.0" || data.id !== 1 || data.error || !Array.isArray(data.result)) throw new Error();
      return data.result;
    } catch { throw new Error("Ethereum pool discovery is temporarily unavailable."); }
  };
}
