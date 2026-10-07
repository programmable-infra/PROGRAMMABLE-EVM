"use client";

import type { Hex } from "viem";
import type { FoundationStudioDraft } from "./studio";

export interface FoundationLaunchDraftSnapshot {
  draft: FoundationStudioDraft;
  buyEdited: boolean;
  customQuote: boolean;
  localImage: { blob: Blob; sha256: Hex } | null;
}

// Tab-local editing state only. Never retain a quote, review, transaction or wallet authority.
const drafts = new Map<number, FoundationLaunchDraftSnapshot | null>();
let latest: FoundationLaunchDraftSnapshot | null = null;
const copy = (value: FoundationLaunchDraftSnapshot): FoundationLaunchDraftSnapshot => ({
  ...value, draft: structuredClone(value.draft), localImage: value.localImage ? { ...value.localImage } : null,
});

export function readFoundationLaunchDraft(chainId: number): FoundationLaunchDraftSnapshot | null {
  if (typeof window === "undefined") return null;
  if (drafts.has(chainId)) return drafts.get(chainId) ? copy(drafts.get(chainId)!) : null;
  if (!latest) return null;
  const seed = copy(latest);
  // Keep the coin's presentation when first switching networks, but never carry
  // contract addresses, module configurations or a quote-token valuation across chains.
  seed.draft.modules = [];
  seed.draft.quoteAsset = "";
  delete seed.draft.quoteValuation;
  seed.customQuote = false;
  return seed;
}

export function rememberFoundationLaunchDraft(chainId: number, value: FoundationLaunchDraftSnapshot): void {
  if (typeof window === "undefined") return;
  const snapshot = copy(value);
  // An uploaded image must be rebound to the current wallet by uploading its retained blob.
  if (snapshot.localImage) snapshot.draft.image = null;
  drafts.set(chainId, snapshot);
  latest = snapshot;
}

export function clearFoundationLaunchDraft(chainId: number): void {
  if (latest === drafts.get(chainId)) latest = null;
  drafts.set(chainId, null);
}
