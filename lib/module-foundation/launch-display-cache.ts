import { getAddress, type Address, type PublicClient } from "viem";
import type { FoundationAvailabilityEnvelope } from "./availability";
import { readFoundationQuote } from "./client";
import { foundationBindingChainId, foundationChainProfile, foundationClientProfile, type FoundationChainId } from "./chains";
import { readFoundationFirstBuyPolicy, type FoundationFirstBuyPolicy } from "./first-buy";

const listeners = new Set<() => void>();
const catalogs = new Map<FoundationChainId, { value: FoundationAvailabilityEnvelope; expiresAt: number }>();
const suggestedBuys = new Map<FoundationChainId, { policy: Promise<FoundationFirstBuyPolicy>; promise: Promise<string>; expiresAt: number }>();

/** Share the editable suggestion across route visits, never an execution quote. */
function firstBuyForDisplay(client: PublicClient, now: number) {
  const chainId = foundationClientProfile(client).chainId;
  const existing = suggestedBuys.get(chainId);
  if (existing && existing.expiresAt > now) return existing;
  const entry = { policy: null as unknown as Promise<FoundationFirstBuyPolicy>, promise: null as unknown as Promise<string>, expiresAt: Number.POSITIVE_INFINITY };
  entry.policy = readFoundationFirstBuyPolicy(client).then(value => {
    entry.expiresAt = Date.now() + 30_000;
    return value;
  }).catch(error => {
    if (suggestedBuys.get(chainId) === entry) suggestedBuys.delete(chainId);
    throw error;
  });
  entry.promise = entry.policy.then(value => value.suggestedEth);
  // A caller may request only the policy; observe the derived promise's rejection too.
  void entry.promise.catch(() => undefined);
  suggestedBuys.set(chainId, entry);
  return entry;
}
export function readFoundationSuggestedBuyForDisplay(client: PublicClient, now = Date.now()): Promise<string> {
  return firstBuyForDisplay(client, now).promise;
}
export function readFoundationFirstBuyPolicyForDisplay(client: PublicClient, now = Date.now()): Promise<FoundationFirstBuyPolicy> {
  return firstBuyForDisplay(client, now).policy;
}

/** Display only. The session still fetches fresh authority before it can prepare a launch. */
export function readFoundationLaunchDisplay(now = Date.now(), chainId: FoundationChainId = 4663): FoundationAvailabilityEnvelope | null {
  const catalog = catalogs.get(foundationChainProfile(chainId).chainId);
  return catalog && catalog.expiresAt > now ? catalog.value : null;
}
export function subscribeFoundationLaunchDisplay(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function rememberFoundationLaunchDisplay(value: FoundationAvailabilityEnvelope, now = Date.now()) {
  if (value.token !== undefined) return;
  const chainId = foundationBindingChainId(value.binding ?? value);
  if (value.available && value.binding) catalogs.set(chainId, { value, expiresAt: now + 180_000 });
  else catalogs.delete(chainId);
  listeners.forEach(listener => listener());
}

type Quote = Awaited<ReturnType<typeof readFoundationQuote>>;
const quotes = new Map<string, { promise: Promise<Quote>; expiresAt: number }>();

/** Shares bounded metadata reads, never wallet balances, simulations or spending authority. */
export function readFoundationQuoteForDisplay(client: PublicClient, raw: Address, now = Date.now()): Promise<Quote> {
  if (client.chain?.id !== 1 && client.chain?.id !== 4663) return Promise.reject(new Error("Choose a token on a supported launch network."));
  const chainId = foundationChainProfile(client.chain.id).chainId;
  const address = getAddress(raw), key = `${chainId}:${address.toLowerCase()}`;
  const existing = quotes.get(key);
  if (existing && existing.expiresAt > now) return existing.promise;
  const entry = { promise: null as unknown as Promise<Quote>, expiresAt: Number.POSITIVE_INFINITY };
  entry.promise = readFoundationQuote(client, address).then(value => {
    entry.expiresAt = Date.now() + 30_000;
    return Object.freeze(value);
  }).catch(error => {
    if (quotes.get(key) === entry) quotes.delete(key);
    throw error;
  });
  quotes.delete(key);
  quotes.set(key, entry);
  while (quotes.size > 32) quotes.delete(quotes.keys().next().value!);
  return entry.promise;
}
