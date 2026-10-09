import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SHARD_PUBLIC_PRESENTATION_V1 } from
  "../lib/custom-launch/router-trade-adapters-v1";
import {
  publicExploreCatalogEntriesV1,
  publicExplorePresentationEntryV1,
} from
  "../lib/public-explore-catalog-v1";
import type {
  CanonicalTokenExploreEntry,
  ExploreEntry,
} from "../lib/tokens";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";

function routerEntry(
  tokenAddress: `0x${string}`,
  launchId: `0x${string}`,
): ExploreEntry {
  return {
    ...customGraphExploreEntry,
    id: `1:${tokenAddress.toLowerCase()}`,
    tokenAddress,
    launchStampProvenance: {
      ...customGraphExploreEntry.launchStampProvenance,
      launchId,
    },
    launchCategoryProvenance: {
      ...customGraphExploreEntry.launchCategoryProvenance,
      launchId,
    },
  };
}

describe("public Explore catalog exclusions", () => {
  it("attaches Ethperiment artwork and X only to its exact finalized launch", () => {
    const entry = {
      ...routerEntry("0xf9f7944aa311535fd86b7daa17e6d3e753915bd7", "0x41f47f07e4afeba4495130c065d6cf60e4263c2628e03092ccc328a9d29d02b1"),
      launchStampProvenance: { ...customGraphExploreEntry.launchStampProvenance,
        launchId: "0x41f47f07e4afeba4495130c065d6cf60e4263c2628e03092ccc328a9d29d02b1",
        stampHash: "0x25bb83d3b2ec32e8f7af86ff76134dfd3416ed50f216f6ee83bd4144cb84bf0b" },
      links: [{ kind: "website", url: "https://ethperiment.live/e/house" }],
    } as CanonicalTokenExploreEntry;
    expect(publicExplorePresentationEntryV1(entry)).toMatchObject({
      imageUrl: "/token-images/ethperiment.png",
      links: [...entry.links!, { kind: "x", url: "https://x.com/Ethperiment" }],
      launchStampProvenance: entry.launchStampProvenance,
    });
    const otherChain = { ...entry, launchStampProvenance: { ...entry.launchStampProvenance!, chainId: 4663 } } as CanonicalTokenExploreEntry;
    expect(publicExplorePresentationEntryV1(otherChain)).toBe(otherChain);
  });

  it("requires both the exact token address and exact launch id", () => {
    const tokenAddress =
      "0x69D278968AbF120F878F2E1E016Ab615D3686c19" as const;
    const launchId =
      "0x6d6ed0e1e69a7cd6afa177e3454c9e32eed61cbd3f855ee56aff1915a6776fc2" as const;
    const exact = routerEntry(tokenAddress, launchId);
    const addressOnly = routerEntry(tokenAddress, `0x${"ab".repeat(32)}`);
    const launchOnly = routerEntry(
      "0x1111111111111111111111111111111111111111",
      launchId,
    );

    expect(publicExploreCatalogEntriesV1([
      exact,
      addressOnly,
      launchOnly,
    ])).toEqual([addressOnly, launchOnly]);
  });

  it("attaches the exact SHARD image and social links only to its launch stamp", () => {
    const exact = {
      ...routerEntry(
        SHARD_PUBLIC_PRESENTATION_V1.tokenAddress,
        SHARD_PUBLIC_PRESENTATION_V1.launchId,
      ),
      launchStampProvenance: {
        ...customGraphExploreEntry.launchStampProvenance,
        launchId: SHARD_PUBLIC_PRESENTATION_V1.launchId,
        stampHash: SHARD_PUBLIC_PRESENTATION_V1.stampHash,
      },
    } as CanonicalTokenExploreEntry;
    const enriched = publicExplorePresentationEntryV1(exact);

    expect(enriched).toMatchObject({
      description: SHARD_PUBLIC_PRESENTATION_V1.description,
      imageUrl: SHARD_PUBLIC_PRESENTATION_V1.imageUrl,
      links: SHARD_PUBLIC_PRESENTATION_V1.links,
    });
    expect(publicExplorePresentationEntryV1({
      ...exact,
      launchStampProvenance: {
        ...exact.launchStampProvenance!,
        stampHash: `0x${"ab".repeat(32)}`,
      },
    } as CanonicalTokenExploreEntry)).not.toHaveProperty("imageUrl");

    const image = readFileSync(
      `public${SHARD_PUBLIC_PRESENTATION_V1.imageUrl}`,
    );
    expect(createHash("sha256").update(image).digest("hex")).toBe(
      "01311db4e3af189d4b383b7a0f63c615adfcf959c552b2a61df5e5597768fb91",
    );
  });
});
