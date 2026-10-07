import { NextRequest } from "next/server";
import {
  getAddress,
  RpcRequestError,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassicV4PublicRelease } from "../lib/classic-v4-release";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  indexedEnabled: true,
  lookup: vi.fn(),
  readCatalog: vi.fn(),
  createPublicClient: vi.fn(),
  getWebsiteReadOnchainDeployment: vi.fn(),
  classicV4Release: null as ClassicV4PublicRelease | null,
  catalogReleaseVersion: "classic-v3" as string,
  runtimeHashes: {
    "0x01":
      "0x9cc9723456c471d90ac838c02fa4fc47ed4b7e82c85358e71deec978c48d2dc8",
    "0x02":
      "0x3eba781023d3146ed9b502ac5b402d39cea4c34a14f64c878cb9ea62149590f1",
    "0x03":
      "0x874ec76f396807bfcbbdd88cc2fd534f10201242ad0479a05fe5d2ee937616ee",
    "0x04": `0x${"ab".repeat(32)}`,
    "0x05": `0x${"cd".repeat(32)}`,
  } as const,
}));

const account = getAddress("0x1111111111111111111111111111111111111111");
const vault = getAddress("0x2222222222222222222222222222222222222222");
const token = getAddress("0x3333333333333333333333333333333333333333");
const launcher = getAddress("0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770");
const hook = getAddress("0x35fe236ea82f7cf525c9719d7df8f49f94d720cc");
const factory = getAddress("0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a");
const v4Launcher = getAddress("0x4444444444444444444444444444444444444444");
const v4Hook = getAddress("0x5555555555555555555555555555555555555555");
const otherFactory = getAddress("0x6666666666666666666666666666666666666666");
const newPayoutAddress = getAddress(
  "0x9999999999999999999999999999999999999999",
);
const poolId = `0x${"44".repeat(32)}` as Hex;
const blockHash = `0x${"55".repeat(32)}` as Hex;
const launchTransactionHash = `0x${"66".repeat(32)}` as Hex;
const drpcRpcUrl =
  "https://lb.drpc.live/ethereum/drpc-classic-key";
const quickNodeRpcUrl =
  "https://classic-mainnet.ethereum-mainnet.quiknode.pro/quicknode-classic-key/";
const deployment = {
  status: "ready" as const,
  environment: "production" as const,
  releaseVersion: "classic-v2" as const,
  chainId: 1 as const,
  rpcUrl: drpcRpcUrl,
  rpcUrlSecondary: quickNodeRpcUrl,
  rpcProviderIds: {
    primary: "drpc",
    secondary: "quicknode",
  },
};

const indexedToken = {
  chainId: 1 as const,
  releaseVersion: "classic-v3" as const,
  modelVersion: "classic" as const,
  tokenAddress: token,
  creatorAddress: account,
  launchTransactionHash,
  poolId,
  rewardVaultAddress: vault,
  launchHash: `0x${"77".repeat(32)}` as Hex,
  tokenName: "Classic Token",
  tokenSymbol: "CLS",
  totalSupplyRaw: "1000000000000000000000000000",
  launchedAt: "2026-07-31T00:00:00.000Z",
  hookAddress: hook,
  quoteAssetAddress: null,
  totalSwapFeeBps: 100,
  buySwapFeeBps: 100,
  sellSwapFeeBps: 100,
  buyCreatorFeeBps: 90,
  sellCreatorFeeBps: 90,
  creatorFeeBps: null,
  launcherFeeBps: 10,
  transferTaxBps: 0,
  lpFeePips: 0,
  promotedBlockNumber: "25639608",
  promotedBlockHash: blockHash,
  verifiedAt: "2026-07-31T00:01:00.000Z",
};

const actionReward = {
  chainId: 1 as const,
  account,
  vaultAddress: vault,
  poolId,
  hookAddress: hook,
  quoteAssetAddress: null,
  claimableRaw: "110000000000000000",
  claimedRaw: "0",
  entitledRaw: "110000000000000000",
  releaseVersion: "classic-v3" as const,
  modelVersion: "classic" as const,
  promotedBlockNumber: "25639608",
  promotedBlockHash: blockHash,
  verifiedAt: "2026-07-31T00:01:00.000Z",
  token: indexedToken,
};

const launchLog = {
  removed: false,
  transactionHash: launchTransactionHash,
  args: {
    deployer: account,
    token,
    poolId,
    feeHook: hook,
    rewardVault: vault,
    positionRecipient: account,
    positionTokenId: 1n,
    buySwapFeeBps: 100,
    sellSwapFeeBps: 100,
    rewardConfigurationHash: `0x${"88".repeat(32)}` as Hex,
    launchHash: `0x${"77".repeat(32)}` as Hex,
  },
};

function classicV4Release(
  rewardVaultFactory: Address = factory,
  publicAvailable = true,
): ClassicV4PublicRelease {
  const rewardVaultFactoryRuntimeCodeHash =
    rewardVaultFactory === factory
      ? mocks.runtimeHashes["0x03"]
      : (`0x${"ef".repeat(32)}` as Hex);
  return {
    chainId: 1,
    model: "classic",
    internalContractRelease: "classic-v4",
    releaseStatus: publicAvailable
      ? "publicly-available"
      : "indexer-activated",
    addresses: {
      launcher: v4Launcher,
      feeHook: v4Hook,
      rewardVaultFactory,
    },
    deploymentBlocks: { launcher: 25_639_596 },
    runtimeCodeHashes: {
      launcher: mocks.runtimeHashes["0x04"],
      feeHook: mocks.runtimeHashes["0x05"],
      rewardVaultFactory: rewardVaultFactoryRuntimeCodeHash,
    },
    sharedDependencies: {
      rewardVaultFactory: {
        address: rewardVaultFactory,
        runtimeCodeHash: rewardVaultFactoryRuntimeCodeHash,
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
      publicAvailable,
    },
  } as unknown as ClassicV4PublicRelease;
}

function catalogEntry(releaseVersion: string) {
  const isV4 = releaseVersion === "classic-v4";
  return {
    exploreKind: "token",
    launchModelVersion: releaseVersion,
    rewardVaultAddress: vault,
    hookAddress: isV4 ? v4Hook : hook,
    poolId,
    buyHookFeeBps: isV4 ? 10 : 100,
    sellHookFeeBps: isV4 ? 10 : 100,
    lpFeePips: 0,
  };
}

function codeAt(address: Address) {
  const normalized = address.toLowerCase();
  if (normalized === launcher.toLowerCase()) return "0x01" as Hex;
  if (normalized === hook.toLowerCase()) return "0x02" as Hex;
  if (normalized === factory.toLowerCase()) return "0x03" as Hex;
  if (normalized === v4Launcher.toLowerCase()) return "0x04" as Hex;
  if (normalized === v4Hook.toLowerCase()) return "0x05" as Hex;
  if (normalized === vault.toLowerCase()) return "0x6004" as Hex;
  return "0x" as Hex;
}

function contractRead(functionName: string) {
  const isV4 = mocks.catalogReleaseVersion === "classic-v4";
  const selectedHook = isV4 ? v4Hook : hook;
  const selectedLauncher = isV4 ? v4Launcher : launcher;
  const totalFeeBps = isV4 ? 10 : 100;
  switch (functionName) {
    case "shareBpsOf":
    case "shareBpsAt":
      return 10_000n;
    case "claimable":
      return 10n ** 17n;
    case "claimedBy":
      return 0n;
    case "name":
      return "Classic Token";
    case "symbol":
      return "CLS";
    case "beneficiaryCount":
      return 1n;
    case "isFactoryVault":
      return true;
    case "feeDisclosure":
      return [
        totalFeeBps,
        totalFeeBps,
        totalFeeBps - 10,
        totalFeeBps - 10,
        10,
        0,
        0,
        vault,
      ];
    case "poolFeeConfig":
      return [
        vault,
        selectedLauncher,
        totalFeeBps,
        totalFeeBps,
        true,
        10n ** 16n,
      ];
    case "feeHook":
      return selectedHook;
    case "poolId":
      return poolId;
    case "beneficiaryAt":
      return account;
    default:
      throw new Error(`Unexpected function ${functionName}`);
  }
}

function identityClient() {
  const getLogs = vi.fn(
    async ({ address }: { address: Address }) =>
      address.toLowerCase() === v4Launcher.toLowerCase()
        ? [{
            ...launchLog,
            args: {
              ...launchLog.args,
              feeHook: v4Hook,
              buySwapFeeBps: 10,
              sellSwapFeeBps: 10,
            },
          }]
        : [],
  );
  return {
    getCode: vi.fn(({ address }: { address: Address }) =>
      Promise.resolve(codeAt(address)),
    ),
    getBlockNumber: vi.fn().mockResolvedValue(25_639_608n),
    getLogs,
    readContract: vi.fn(
      ({ functionName }: { functionName: string }) =>
        Promise.resolve(contractRead(functionName)),
    ),
    call: vi.fn(),
  };
}

function actionClient(index: number) {
  return {
    getCode: vi.fn(({ address }: { address: Address }) =>
      Promise.resolve(codeAt(address)),
    ),
    getBlockNumber: vi.fn().mockResolvedValue(25_700_000n),
    getBlock: vi.fn().mockResolvedValue({ hash: blockHash }),
    readContract: vi.fn(
      ({ functionName }: { functionName: string }) =>
        Promise.resolve(contractRead(functionName)),
    ),
    call: vi.fn().mockResolvedValue({ data: "0x" }),
    estimateGas: vi.fn().mockResolvedValue(100_000n + BigInt(index)),
    getGasPrice: vi.fn().mockResolvedValue(2_000_000_000n + BigInt(index)),
    getBalance: vi.fn().mockResolvedValue(10n ** 18n),
  };
}

vi.mock("../lib/data-pipeline/route-activation.server", () => ({
  indexedLaunchLookupEnabled: () => mocks.indexedEnabled,
}));

vi.mock("../lib/data-pipeline/action-lookup", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/data-pipeline/action-lookup")>();
  return {
    ...actual,
    lookupActionReward: mocks.lookup,
  };
});

vi.mock("../lib/market-data/classic-launch-catalog.server", () => ({
  readClassicLaunchCatalogV1: mocks.readCatalog,
}));

vi.mock("../lib/classic-v4-release", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/classic-v4-release")>();
  return {
    ...actual,
    getConfiguredClassicV4PublicRelease: () => mocks.classicV4Release,
  };
});

vi.mock("../lib/onchain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/onchain")>();
  return {
    ...actual,
    getWebsiteReadOnchainDeployment:
      mocks.getWebsiteReadOnchainDeployment,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    keccak256: vi.fn((value: keyof typeof mocks.runtimeHashes) => {
      const mocked = mocks.runtimeHashes[value];
      return mocked ?? actual.keccak256(value);
    }),
  };
});

import { GET, POST } from "../app/api/profile/classic-v3/route";

function request(action: "claim" | "update-payout" = "claim") {
  return new NextRequest("http://localhost/api/profile/classic-v3", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      account,
      vaultAddress: vault,
      chainId: 1,
      ...(action === "update-payout"
        ? { allocationIndex: 0, newPayoutAddress }
        : {}),
    }),
  });
}

describe("Classic V3 action identity activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.classicV4Release = null;
    mocks.catalogReleaseVersion = "classic-v3";
    mocks.getWebsiteReadOnchainDeployment.mockReturnValue(deployment);
    mocks.lookup.mockResolvedValue(actionReward);
    mocks.readCatalog.mockResolvedValue({
      entries: [catalogEntry("classic-v3")],
    });
    mocks.createPublicClient.mockImplementation(() => actionClient(0));
  });

  it.each([true, false])(
    "uses Envio identity and one RPC when indexed lookup is %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;

      const response = await POST(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "ready",
        action: "claim",
        account,
        vaultAddress: vault,
        transaction: {
          kind: "claim-classic-v3-rewards",
          chainId: 1,
          from: account,
          to: vault,
        },
      });
      expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
      expect(mocks.readCatalog).toHaveBeenCalledTimes(1);
      expect(mocks.lookup).not.toHaveBeenCalled();
    },
  );

  it("retries the complete preparation once on the fixed secondary after primary capacity failure", async () => {
    const primaryRpcError = new RpcRequestError({
      body: { method: "eth_blockNumber" },
      error: { code: 10, message: "User balance exceeded" },
      url: drpcRpcUrl,
    });
    mocks.createPublicClient
      .mockReturnValueOnce({
        getBlockNumber: vi.fn().mockRejectedValue(primaryRpcError),
      })
      .mockReturnValueOnce(actionClient(1));

    const response = await POST(request());
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(2);
    expect(mocks.readCatalog).toHaveBeenCalledTimes(1);
    expect(serialized).not.toContain("drpc-classic-key");
    expect(serialized).not.toContain("quicknode-classic-key");
  });

  it.each([
    ["claim", "claim-classic-v3-rewards"],
    ["update-payout", "update-classic-v3-payout"],
  ] as const)(
    "prepares a manifest-bound Classic V4 %s directly against its reward vault",
    async (action, kind) => {
      mocks.classicV4Release = classicV4Release();
      mocks.catalogReleaseVersion = "classic-v4";
      mocks.readCatalog.mockResolvedValue({
        entries: [catalogEntry("classic-v4")],
      });
      const client = actionClient(0);
      mocks.createPublicClient.mockReturnValue(client);

      const response = await POST(request(action));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "ready",
        action,
        account,
        vaultAddress: vault,
        transaction: {
          kind,
          chainId: 1,
          from: account,
          to: vault,
        },
      });
      expect(client.getCode).toHaveBeenCalledWith({
        address: v4Launcher,
        blockNumber: 25_700_000n,
      });
      expect(client.getCode).toHaveBeenCalledWith({
        address: v4Hook,
        blockNumber: 25_700_000n,
      });
      expect(client.call).toHaveBeenCalledWith(
        expect.objectContaining({ account, to: vault }),
      );
    },
  );

  it("keeps an indexer-activated Classic V4 reward visible on GET", async () => {
    mocks.classicV4Release = classicV4Release(factory, false);
    mocks.catalogReleaseVersion = "classic-v4";
    const client = identityClient();
    mocks.createPublicClient.mockReturnValue(client);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/profile/classic-v3?account=${account}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      account,
      chainId: 1,
      rewards: [{
        tokenAddress: token,
        poolId,
        vaultAddress: vault,
        buySwapFeeBps: 10,
        sellSwapFeeBps: 10,
        platformFeeBps: 10,
      }],
    });
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: v4Hook,
        functionName: "feeDisclosure",
        args: [poolId],
      }),
    );
  });

  it("keeps a Classic V4 catalog row closed until its public manifest is active", async () => {
    mocks.classicV4Release = classicV4Release(factory, false);
    mocks.catalogReleaseVersion = "classic-v4";
    mocks.readCatalog.mockResolvedValue({
      entries: [catalogEntry("classic-v4")],
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This Classic release is not active",
    });
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown catalog release instead of falling back to V3", async () => {
    mocks.catalogReleaseVersion = "classic-v5";
    mocks.readCatalog.mockResolvedValue({
      entries: [catalogEntry("classic-v5")],
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
  });

  it("rejects a Classic V4 manifest that drifts from the shared reward factory pin", async () => {
    mocks.classicV4Release = classicV4Release(otherFactory);
    mocks.catalogReleaseVersion = "classic-v4";
    mocks.readCatalog.mockResolvedValue({
      entries: [catalogEntry("classic-v4")],
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(mocks.readCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps a V3 catalog row bound to V3 when an unrelated V4 manifest is invalid", async () => {
    mocks.classicV4Release = classicV4Release(otherFactory);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
  });
});
