import type { Address, Hex } from "viem";
import type { FoundationChainId } from "./chains";

const requests = new Map<string, Promise<void>>();
/** A receipt hint only; the server independently verifies the transaction before listing it. */
export function announceFoundationLaunch(input: { chainId: FoundationChainId; token: Address; transactionHash: Hex }) {
  const key = `${input.chainId}:${input.token.toLowerCase()}:${input.transactionHash.toLowerCase()}`;
  const existing = requests.get(key);
  if (existing) return existing;
  const task = (async () => {
    for (const delay of [0, 5_000, 20_000]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        const response = await fetch("/api/module-foundation/confirmed", { method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" }, body: JSON.stringify(input), keepalive: true,
          signal: AbortSignal.timeout(55_000) });
        await response.body?.cancel();
        if (response.ok || response.status === 400 || response.status === 403) return;
      } catch { /* The chain transaction remains confirmed. A bounded retry only refreshes discovery. */ }
    }
  })();
  if (requests.size >= 64) requests.delete(requests.keys().next().value!);
  requests.set(key, task);
  return task;
}
