import "server-only";
import { createFoundationClient } from "@/lib/module-foundation/client";
import { foundationChainProfile, type FoundationChainId } from "@/lib/module-foundation/chains";
import { productionMainnetRpcPair } from "@/lib/onchain/website-rpc-providers.server";

/** Keep paid endpoints server-side and reuse the existing role-bound Ethereum providers. */
export function createFoundationServerClient(chainId: FoundationChainId = 4663) {
  foundationChainProfile(chainId);
  if (chainId === 4663) return createFoundationClient({ chainId, batchRpc: true });
  const pair = productionMainnetRpcPair();
  return createFoundationClient({ chainId, batchRpc: true, rpcUrls: [pair.primary.url, pair.secondary.url] });
}
