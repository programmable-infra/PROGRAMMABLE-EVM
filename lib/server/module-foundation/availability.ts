import { foundationBindingChainId, foundationChainProfile, type FoundationChainId } from "@/lib/module-foundation/chains";
import { parseFoundationAvailability } from "@/lib/module-foundation/availability";
import { getAddress, type Address } from "viem";
import { withFoundationOwnerCatalogV1 } from "./owner-catalog";

export class FoundationAvailabilityInputError extends Error {}
const pendingReads = new WeakMap<typeof fetch, Map<string, Promise<unknown>>>();

export function parseFoundationAvailabilityToken(params: URLSearchParams): Address | undefined {
  if ([...params.keys()].some(key => key !== "token") || params.getAll("token").length > 1) {
    throw new FoundationAvailabilityInputError("Use one coin address to check its launch version.");
  }
  const token = params.get("token");
  if (token === null) return undefined;
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(token) || BigInt(token) === 0n || getAddress(token) !== token) throw new Error();
    return token as Address;
  } catch { throw new FoundationAvailabilityInputError("Enter a valid checksummed coin address."); }
}

export function parseFoundationAvailabilityQuery(params: URLSearchParams): { token?: Address; chainId: FoundationChainId } {
  if ([...params.keys()].some(key => key !== "token" && key !== "chainId") || params.getAll("chainId").length > 1) throw new FoundationAvailabilityInputError("Use one launch network and coin address.");
  const raw = params.get("chainId");
  if (raw !== null && raw !== "1" && raw !== "4663") throw new FoundationAvailabilityInputError("Choose Ethereum or Robinhood Chain.");
  const copy = new URLSearchParams(params); copy.delete("chainId");
  return { token: parseFoundationAvailabilityToken(copy), chainId: raw === "1" ? 1 : 4663 };
}

/** The backend rechecks its installed release, accepted database decision and live runtime/finality evidence. */
export async function readFoundationAvailabilityResponse(fetcher: typeof fetch = fetch, timeoutMs = 12_000, token?: Address, chainId: FoundationChainId = 4663): Promise<unknown> {
  foundationChainProfile(chainId);
  if (chainId === 1) return (await import("./ethereum-availability")).readEthereumFoundationAvailability(token);
  if (token !== undefined) parseFoundationAvailabilityToken(new URLSearchParams({ token }));
  const raw = process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL;
  if (!raw) throw new Error("The foundation authority is not configured.");
  const base = new URL(raw);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Invalid foundation authority origin.");
  const prefix = chainId === 4663 ? "/v1/modules/foundation" : `/v2/modules/foundation/chains/${chainId}`;
  const endpoint = token === undefined ? `${prefix}/availability` : `${prefix}/availability/token/${token}`;
  let requests = pendingReads.get(fetcher);
  if (!requests) { requests = new Map(); pendingReads.set(fetcher, requests); }
  const key = `${base.href}:${endpoint}:${timeoutMs}`;
  const existing = requests.get(key);
  if (existing) return existing;
  // Share concurrent verification, never a settled authority response. A later
  // preparation still reads its current runtime, catalog and finality evidence.
  const pending = readCurrentAvailability(fetcher, new URL(endpoint, base), timeoutMs, token, chainId);
  requests.set(key, pending);
  try { return await pending; }
  finally { if (requests.get(key) === pending) requests.delete(key); }
}

async function readCurrentAvailability(fetcher: typeof fetch, endpoint: URL, timeoutMs: number, token: Address | undefined, chainId: FoundationChainId) {
  const response = await fetcher(endpoint, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" },
  });
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.startsWith("application/json") || !response.body) throw new Error("The foundation authority is unavailable.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 2_097_152) throw new Error("The foundation response is too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const parsed = parseFoundationAvailability(value);
  if (foundationBindingChainId(parsed.binding ?? parsed) !== chainId) throw new Error("The source authority returned a different network.");
  if (value === null || typeof value !== "object" || (token === undefined
    ? "token" in value : !("token" in value) || value.token !== token.toLowerCase())) {
    throw new Error("The returned launch version is not bound to this request.");
  }
  const owner = await withFoundationOwnerCatalogV1(parsed);
  return { ...value as Record<string, unknown>, catalog: owner.catalog };
}
