import { beforeEach, describe, expect, it, vi } from "vitest";
import release from "../config/classic-launch-catalog.v1.json";
import { canonicalSha256 } from "../lib/server/projection-target/hashing";
import { canonicalTokenExploreEntryV1 } from "../lib/explore-entry-v1";
import type { ClassicLaunchCatalogV1 } from "../lib/market-data/classic-launch-catalog.server";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/market-data/classic-launch-catalog.server", () => ({ readClassicLaunchCatalogV1: mocks.read }));
import { GET, OPTIONS } from "../app/api/indexers/v1/classic-identities/route";

const hash = `0x${"a".repeat(64)}` as const;
function catalog(status: ClassicLaunchCatalogV1["status"] = "current"): ClassicLaunchCatalogV1 {
  return { source: "codex-classic-launches", status, generatedAt: "2026-10-10T00:00:00.000Z",
    asOfBlock: "26158000", asOfBlockHash: hash,
    entries: [1, 2].map(n => canonicalTokenExploreEntryV1({
      id: `1:${n}`, name: `Launch ${n}`, symbol: `L${n}`, tokenAddress: `0x${String(n).repeat(40)}`,
      creatorAddress: `0x${"3".repeat(40)}`, hookAddress: release.sources[2]!.hook,
      poolId: hash, launchTransactionHash: hash, launchBlockNumber: "26157000", launchLogIndex: n,
      launchedAt: "2026-10-09T23:00:00.000Z", tokenDecimals: 18, totalSwapFeeBps: 100,
      launchModel: "classic", liquidityPath: "meme", imageUrl: undefined,
    })),
    evidence: { commitment: `sha256:${"b".repeat(64)}`, provider: "codex",
      observedAt: "2026-10-10T00:00:00.000Z",
      releaseDigest: canonicalSha256("programmable.classic-launch-catalog.v1", release) },
  };
}

describe("public Classic identity snapshot", () => {
  beforeEach(() => { mocks.read.mockReset(); });

  it("publishes every verified identity without market or Explore filters and binds wire bytes", async () => {
    const source = catalog(); mocks.read.mockResolvedValue(source);
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(body.entries.map((item: { tokenAddress: string }) => item.tokenAddress))
      .toEqual(source.entries.map(item => item.tokenAddress));
    expect(body.identityCount).toBe(2);
    expect(body.identityCommitment).toBe(canonicalSha256(body.schemaVersion, {
      chainId: body.chainId, releaseDigest: body.releaseDigest,
      asOfBlock: body.asOfBlock, asOfBlockHash: body.asOfBlockHash, entries: body.entries,
    }));
    expect(body.releaseDigest).toBe(canonicalSha256("programmable.classic-launch-catalog.v1", body.release));
  });

  it("keeps saved-source freshness visible and uncached", async () => {
    mocks.read.mockResolvedValue(catalog("last-known-good"));
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).status).toBe("last-known-good");
  });

  it("returns a retryable public failure instead of a successful empty feed", async () => {
    mocks.read.mockRejectedValue(new Error("private provider failure"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.text()).not.toContain("private provider");
    expect(OPTIONS().headers.get("access-control-allow-methods")).toContain("GET");
  });
});
