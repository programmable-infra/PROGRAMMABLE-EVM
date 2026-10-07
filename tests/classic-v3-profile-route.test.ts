import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";
import type { ClassicV4PublicRelease } from "../lib/classic-v4-release";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const runtimeCodes = {
    "0x01":
      "0x9cc9723456c471d90ac838c02fa4fc47ed4b7e82c85358e71deec978c48d2dc8",
    "0x02":
      "0x3eba781023d3146ed9b502ac5b402d39cea4c34a14f64c878cb9ea62149590f1",
    "0x03":
      "0x874ec76f396807bfcbbdd88cc2fd534f10201242ad0479a05fe5d2ee937616ee",
    "0x04": `0x${"ab".repeat(32)}`,
    "0x05": `0x${"cd".repeat(32)}`,
  } as const;
  const contractCodes = {
    "0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770": "0x01",
    "0x35fe236ea82f7cf525c9719d7df8f49f94d720cc": "0x02",
    "0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a": "0x03",
    "0x4444444444444444444444444444444444444444": "0x04",
    "0x5555555555555555555555555555555555555555": "0x05",
  } as const;
  const client = {
    getCode: vi.fn(
      async ({ address }: { address: string }) =>
        contractCodes[
          address.toLowerCase() as keyof typeof contractCodes
        ] ?? "0x",
    ),
    getBlockNumber: vi.fn(async () => 25_639_608n),
    getLogs: vi.fn(async (input: { address: string }) => {
      void input.address;
      return [];
    }),
  };
  return {
    client,
    createPublicClient: vi.fn(() => client),
    readClassicLaunchCatalogV1: vi.fn(),
    classicV4Release: null as ClassicV4PublicRelease | null,
    runtimeCodes,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("../lib/data-pipeline/action-lookup", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/data-pipeline/action-lookup")>();
  return {
    ...actual,
    lookupActionReward: vi.fn(async () => {
      throw new actual.ActionLookupError("not-found");
    }),
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    keccak256: vi.fn((value: keyof typeof mocks.runtimeCodes) => {
      const mocked = mocks.runtimeCodes[value];
      return mocked ?? actual.keccak256(value);
    }),
  };
});

vi.mock("../lib/market-data/classic-launch-catalog.server", () => ({
  readClassicLaunchCatalogV1: mocks.readClassicLaunchCatalogV1,
}));

vi.mock("../lib/classic-v4-release", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/classic-v4-release")>();
  return {
    ...actual,
    getConfiguredClassicV4PublicRelease: () => mocks.classicV4Release,
  };
});

import {
  GET,
  POST,
} from "../app/api/profile/classic-v3/route";

const account = "0x1111111111111111111111111111111111111111";
const vault = "0x2222222222222222222222222222222222222222";
const v3Launcher = "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770";
const v4Launcher = "0x4444444444444444444444444444444444444444";
const v4Hook = "0x5555555555555555555555555555555555555555";
const factory = "0xF28967f9DFaC3Ca21384b59D6D75C8106b3eab2a";
const drpcRpcUrl =
  "https://lb.drpc.live/ethereum/drpc-classic-key";
const quickNodeRpcUrl =
  "https://classic-mainnet.ethereum-mainnet.quiknode.pro/quicknode-classic-key/";

function classicV4Release(): ClassicV4PublicRelease {
  return {
    chainId: 1,
    model: "classic",
    internalContractRelease: "classic-v4",
    releaseStatus: "indexer-activated",
    addresses: {
      launcher: v4Launcher,
      feeHook: v4Hook,
      rewardVaultFactory: factory,
    },
    deploymentBlocks: { launcher: 25_639_596 },
    runtimeCodeHashes: {
      launcher: mocks.runtimeCodes["0x04"],
      feeHook: mocks.runtimeCodes["0x05"],
      rewardVaultFactory: mocks.runtimeCodes["0x03"],
    },
    sharedDependencies: {
      rewardVaultFactory: {
        address: factory,
        runtimeCodeHash: mocks.runtimeCodes["0x03"],
      },
    },
    verification: {
      deploymentLive: true,
      deploymentFinalized: true,
      runtimeCodeVerified: true,
      constructorBindingsVerified: true,
      sourceVerified: true,
      lifecycleVerified: true,
      indexerActivated: true,
      publicAvailable: false,
    },
  } as unknown as ClassicV4PublicRelease;
}

describe("Classic profile release gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.classicV4Release = null;
    mocks.createPublicClient.mockReturnValue(mocks.client);
    mocks.readClassicLaunchCatalogV1.mockResolvedValue({ entries: [] });
    vi.stubEnv("ETHEREUM_RPC_URL", drpcRpcUrl);
    vi.stubEnv("ETHEREUM_RPC_URL_B", quickNodeRpcUrl);
    vi.stubEnv("PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER", "drpc");
    vi.stubEnv("PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL", drpcRpcUrl);
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT",
      rpcProviderCommitment("endpoint", drpcRpcUrl),
    );
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_PROVIDER",
      "quicknode",
    );
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL",
      quickNodeRpcUrl,
    );
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT",
      rpcProviderCommitment("endpoint", quickNodeRpcUrl),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the verified release with no rewards for an unused wallet", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      account,
      chainId: 1,
      rewards: [],
    });
  });

  it("uses exactly one commitment-bound dRPC client for the public GET", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "rpc",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "drpc-primary",
    );
  });

  it("reads both exact launchers when the Classic V4 indexer manifest is active", async () => {
    mocks.classicV4Release = classicV4Release();

    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(
      mocks.client.getLogs.mock.calls.map(([input]) => input.address),
    ).toEqual(expect.arrayContaining([v3Launcher, v4Launcher]));
    expect(mocks.client.getCode).toHaveBeenCalledWith({
      address: v4Launcher,
      blockNumber: 25_639_596n,
    });
    expect(mocks.client.getCode).toHaveBeenCalledWith({
      address: v4Hook,
      blockNumber: 25_639_596n,
    });
  });

  it("returns 503 without fallback when the sole dRPC read fails", async () => {
    mocks.client.getBlockNumber.mockRejectedValueOnce(
      new Error("dRPC unavailable"),
    );

    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      error: {
        kind: "temporary",
        code: "classic_profile_temporarily_unavailable",
        message: "Classic rewards are temporarily unavailable",
      },
    });
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid launch lookup hashes before reading a provider", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}&launch=bad`,
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Enter a valid launch transaction hash",
    });
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });

  it("rejects claims from a wallet that does not own the vault", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/profile/classic-v3", {
        method: "POST",
        body: JSON.stringify({
          action: "claim",
          account,
          vaultAddress: vault,
          chainId: 1,
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only a current or historic payout wallet can continue",
    });
  });
});
