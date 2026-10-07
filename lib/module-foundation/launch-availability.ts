import { keccak256, toHex } from "viem";
import { presentFoundationCatalogV1 } from "./presentation";

// These published modules still need separate execution or payout transactions.
// Hold new website selections until their unattended operation is ready on both chains.
const comingSoonModuleIds = new Set([
  "buyback-burn", "dip-buyback", "lp-rewards", "full-range-lp",
  "buyer-rewards", "nth-buy-pot", "king-of-the-hill",
].map(family => keccak256(toHex(`programmable.foundation.${family}.v1`))));

/** New-launch presentation only; installed modules and their public actions stay readable. */
export function presentFoundationLaunchCatalogV1(input: Parameters<typeof presentFoundationCatalogV1>[0]) {
  const comingSoonPackages = new Set<string>(input.catalog.entries
    .filter(entry => comingSoonModuleIds.has(entry.runtime.descriptor.moduleId))
    .map(entry => entry.manifest.packageId));
  return presentFoundationCatalogV1(input).map(module => comingSoonPackages.has(module.id)
    ? { ...module, available: false, comingSoon: true,
      unavailableReason: "Coming soon. This module is not available for new launches yet." }
    : module);
}
