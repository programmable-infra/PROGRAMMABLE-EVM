import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import appDeployments from "@/contracts/config/app-deployments.v1.json";
import {
  classicRewardVaultAbi,
  classicRewardVaultFactoryAbi,
  classicV3HookAbi,
  type ClassicV3DeploymentManifest,
} from "@/lib/classic-v3";
import {
  getConfiguredClassicV3Release,
  isClassicV3ReleaseVerified,
} from "@/lib/classic-v3-release";
import {
  getConfiguredClassicV4PublicRelease,
  isClassicV4PublicActionRelease,
} from "@/lib/classic-v4-release";
import { uerc20ReadAbi } from "@/lib/onchain/abis";
import { getWebsiteReadOnchainDeployment } from "@/lib/onchain";
import {
  readClassicLaunchCatalogV1,
} from "@/lib/market-data/classic-launch-catalog.server";
import {
  safeOperationalRpcError,
  withOperationalRpcFailover,
} from
  "@/lib/onchain/operational-rpc-failover.server";
import {
  classicV3ProfileApiError,
  encodeClassicV3RewardAction,
} from "@/lib/profile/classic-v3-rewards";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const CONFIRMATIONS = 12n;

type ClassicActionRewardIdentity = Readonly<{
  vaultAddress: Address;
  poolId: Hex;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  buyCreatorFeeBps: number | null;
  sellCreatorFeeBps: number | null;
  launcherFeeBps: number;
  transferTaxBps: number;
  lpFeePips: number;
}>;
type ClassicActionReleaseVersion = "classic-v3" | "classic-v4";
type ClassicActionRelease = Readonly<{
  releaseVersion: ClassicActionReleaseVersion;
  launcher: Address;
  hook: Address;
  rewardVaultFactory: Address;
  launcherRuntimeCodeHash: Hex;
  hookRuntimeCodeHash: Hex;
  rewardVaultFactoryRuntimeCodeHash: Hex;
  launcherDeploymentBlock: bigint;
}>;

const environment =
  process.env.PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const manifest = appDeployments[
  environment
] as unknown as ClassicV3DeploymentManifest;
const releaseManifest =
  getConfiguredClassicV3Release(environment).releaseManifest;
const chain = environment === "rehearsal" ? sepolia : mainnet;

function runtimeCodeHash(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 66
  ) {
    throw new Error(`${label} is not pinned`);
  }
  return value as Hex;
}

function classicRewardFactoryPin() {
  if (
    typeof manifest.classicRewardVaultFactoryV1 !== "string" ||
    !isAddress(manifest.classicRewardVaultFactoryV1) ||
    typeof releaseManifest.addresses?.rewardVaultFactory !== "string" ||
    !isAddress(releaseManifest.addresses.rewardVaultFactory)
  ) {
    throw new Error("Classic reward factory is not pinned");
  }
  const address = getAddress(manifest.classicRewardVaultFactoryV1);
  const releaseAddress = getAddress(
    releaseManifest.addresses.rewardVaultFactory,
  );
  const pinnedRuntimeCodeHash = runtimeCodeHash(
    manifest.runtimeCodeHashes?.classicRewardVaultFactoryV1,
    "Classic reward factory runtime",
  );
  const releaseRuntimeCodeHash = runtimeCodeHash(
    releaseManifest.runtimeCodeHashes?.rewardVaultFactory,
    "Classic release reward factory runtime",
  );
  if (
    address.toLowerCase() !== releaseAddress.toLowerCase() ||
    pinnedRuntimeCodeHash.toLowerCase() !==
      releaseRuntimeCodeHash.toLowerCase()
  ) {
    throw new Error("Classic reward factory pins do not match");
  }
  return {
    address,
    runtimeCodeHash: pinnedRuntimeCodeHash,
  } as const;
}

function configuredClassicV3ActionRelease(): ClassicActionRelease | null {
  if (!isClassicV3ReleaseVerified(manifest, releaseManifest, chain.id)) {
    return null;
  }
  const rewardVaultFactory = classicRewardFactoryPin();
  return {
    releaseVersion: "classic-v3",
    launcher: getAddress(manifest.memeLaunchV2 as string),
    hook: getAddress(manifest.ethCreatorFeeHookV3 as string),
    rewardVaultFactory: rewardVaultFactory.address,
    launcherRuntimeCodeHash: runtimeCodeHash(
      manifest.runtimeCodeHashes?.memeLaunchV2,
      "Classic V3 launcher runtime",
    ),
    hookRuntimeCodeHash: runtimeCodeHash(
      manifest.runtimeCodeHashes?.ethCreatorFeeHookV3,
      "Classic V3 hook runtime",
    ),
    rewardVaultFactoryRuntimeCodeHash: rewardVaultFactory.runtimeCodeHash,
    launcherDeploymentBlock: BigInt(
      manifest.deploymentBlocks?.memeLaunchV2 as number,
    ),
  };
}

function configuredClassicV4ActionRelease(
  requirePublicAvailability = false,
): ClassicActionRelease | null {
  const release = getConfiguredClassicV4PublicRelease(environment);
  if (!release) return null;
  if (
    requirePublicAvailability &&
    !isClassicV4PublicActionRelease(release)
  ) {
    return null;
  }
  if (
    environment !== "production" ||
    release.chainId !== chain.id ||
    release.model !== "classic" ||
    release.internalContractRelease !== "classic-v4" ||
    release.verification.deploymentLive !== true ||
    release.verification.deploymentFinalized !== true ||
    release.verification.runtimeCodeVerified !== true ||
    release.verification.constructorBindingsVerified !== true ||
    release.verification.sourceVerified !== true ||
    release.verification.lifecycleVerified !== true ||
    release.verification.indexerActivated !== true
  ) {
    throw new Error("Classic V4 public release is not active");
  }

  const rewardVaultFactory = classicRewardFactoryPin();
  const releaseFactory = getAddress(release.addresses.rewardVaultFactory);
  const sharedFactory = release.sharedDependencies.rewardVaultFactory;
  const releaseFactoryRuntimeCodeHash = runtimeCodeHash(
    release.runtimeCodeHashes.rewardVaultFactory,
    "Classic V4 reward factory runtime",
  );
  if (
    releaseFactory.toLowerCase() !== rewardVaultFactory.address.toLowerCase() ||
    getAddress(sharedFactory.address).toLowerCase() !==
      rewardVaultFactory.address.toLowerCase() ||
    releaseFactoryRuntimeCodeHash.toLowerCase() !==
      rewardVaultFactory.runtimeCodeHash.toLowerCase() ||
    runtimeCodeHash(
      sharedFactory.runtimeCodeHash,
      "Classic V4 shared reward factory runtime",
    ).toLowerCase() !== rewardVaultFactory.runtimeCodeHash.toLowerCase()
  ) {
    throw new Error("Classic V4 reward factory does not match the shared pin");
  }
  if (
    !Number.isSafeInteger(release.deploymentBlocks.launcher) ||
    release.deploymentBlocks.launcher < 1
  ) {
    throw new Error("Classic V4 launcher deployment block is not pinned");
  }

  return {
    releaseVersion: "classic-v4",
    launcher: getAddress(release.addresses.launcher),
    hook: getAddress(release.addresses.feeHook),
    rewardVaultFactory: rewardVaultFactory.address,
    launcherRuntimeCodeHash: runtimeCodeHash(
      release.runtimeCodeHashes.launcher,
      "Classic V4 launcher runtime",
    ),
    hookRuntimeCodeHash: runtimeCodeHash(
      release.runtimeCodeHashes.feeHook,
      "Classic V4 hook runtime",
    ),
    rewardVaultFactoryRuntimeCodeHash: rewardVaultFactory.runtimeCodeHash,
    launcherDeploymentBlock: BigInt(release.deploymentBlocks.launcher),
  };
}

function configuredClassicActionReleases(
  requirePublicAvailability = false,
) {
  const v3 = configuredClassicV3ActionRelease();
  const v4 = configuredClassicV4ActionRelease(requirePublicAvailability);
  const releases = [
    ...(v3 ? [v3] : []),
    ...(v4 ? [v4] : []),
  ];
  if (
    new Set(releases.map((release) => release.launcher.toLowerCase())).size !==
      releases.length ||
    new Set(releases.map((release) => release.hook.toLowerCase())).size !==
      releases.length
  ) {
    throw new Error("Classic release identities overlap");
  }
  return releases;
}
function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function createActionClient(rpcUrl: string) {
  return createPublicClient({
    chain,
    batch: { multicall: true },
    transport: http(rpcUrl, { retryCount: 1, timeout: 12_000 }),
  });
}

async function currentActionBlock(client: PublicClient) {
  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  if (!block.hash) throw new Error("The configured RPC returned no block hash");
  return blockNumber;
}

function classicActionDeployment() {
  const deployment = getWebsiteReadOnchainDeployment(environment);
  if (deployment.chainId !== chain.id) {
    throw new Error("Classic action RPC chain does not match the release");
  }
  return deployment;
}

function classicRpcProviderHeader(
  deployment: ReturnType<typeof classicActionDeployment>,
  rpcUrl: string,
) {
  const role = rpcUrl === deployment.rpcUrl ? "primary" : "secondary";
  const provider = deployment.rpcProviderIds?.[role] ?? "rpc";
  return `${provider}-${role}`;
}

async function assertCodeHashAtBlock(
  client: PublicClient,
  address: Address,
  expectedHash: string,
  blockNumber: bigint,
  label: string,
) {
  const code = await client.getCode({ address, blockNumber });
  if (
    !code ||
    code === "0x" ||
    keccak256(code).toLowerCase() !== expectedHash.toLowerCase()
  ) {
    throw new Error(`${label} does not match the Classic manifest`);
  }
}

function readLaunchByTransaction(
  account: Address,
  transactionHash: Hex,
  entries: readonly CanonicalTokenExploreEntry[],
) {
  const releases = configuredClassicActionReleases();
  if (releases.length === 0) return { status: "not-deployed" as const, launch: null };
  const launches = entries.filter(entry => entry.creatorAddress?.toLowerCase() === account.toLowerCase()
    && entry.launchTransactionHash?.toLowerCase() === transactionHash.toLowerCase()
    && releases.some(release => release.releaseVersion === entry.launchModelVersion
      && release.hook.toLowerCase() === entry.hookAddress.toLowerCase()));
  if (launches.length > 1) throw new Error("Classic launch transaction identity is ambiguous");
  const launch = launches[0];
  return { status: "ready" as const, launch: launch ? {
    tokenAddress: launch.tokenAddress, name: launch.name, symbol: launch.symbol,
    launchTransactionHash: launch.launchTransactionHash,
  } : null };
}

function prospectiveAllocation(
  amount: bigint,
  allocations: readonly { payoutAddress: Address; shareBps: number }[],
  account: Address,
) {
  let allocated = 0n;
  let accountAmount = 0n;
  for (let index = 0; index < allocations.length; index += 1) {
    const allocation =
      index === allocations.length - 1
        ? amount - allocated
        : (amount * BigInt(allocations[index].shareBps)) / 10_000n;
    allocated += allocation;
    if (
      allocations[index].payoutAddress.toLowerCase() ===
      account.toLowerCase()
    ) {
      accountAmount += allocation;
    }
  }
  return accountAmount;
}

async function readClassicActionState(input: {
  client: PublicClient;
  release: ClassicActionRelease;
  reward: ClassicActionRewardIdentity;
  account: Address;
  blockNumber: bigint;
  allocationIndex?: number;
}) {
  const {
    client,
    release,
    reward,
    account,
    blockNumber,
    allocationIndex,
  } = input;
  await Promise.all([
    assertCodeHashAtBlock(
      client,
      release.launcher,
      release.launcherRuntimeCodeHash,
      blockNumber,
      `${release.releaseVersion} launcher`,
    ),
    assertCodeHashAtBlock(
      client,
      release.hook,
      release.hookRuntimeCodeHash,
      blockNumber,
      `${release.releaseVersion} hook`,
    ),
    assertCodeHashAtBlock(
      client,
      release.rewardVaultFactory,
      release.rewardVaultFactoryRuntimeCodeHash,
      blockNumber,
      "Classic reward factory",
    ),
  ]);
  const [
    vaultCode,
    factoryVault,
    vaultHook,
    vaultPoolId,
    beneficiaryCount,
    shareBps,
    checkpointed,
    claimed,
    disclosure,
    poolConfig,
  ] = await Promise.all([
    client.getCode({ address: reward.vaultAddress, blockNumber }),
    client.readContract({
      address: release.rewardVaultFactory,
      abi: classicRewardVaultFactoryAbi,
      functionName: "isFactoryVault",
      args: [reward.vaultAddress],
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "feeHook",
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "poolId",
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "beneficiaryCount",
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "shareBpsOf",
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "claimable",
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: reward.vaultAddress,
      abi: classicRewardVaultAbi,
      functionName: "claimedBy",
      args: [account],
      blockNumber,
    }),
    client.readContract({
      address: release.hook,
      abi: classicV3HookAbi,
      functionName: "feeDisclosure",
      args: [reward.poolId],
      blockNumber,
    }),
    client.readContract({
      address: release.hook,
      abi: classicV3HookAbi,
      functionName: "poolFeeConfig",
      args: [reward.poolId],
      blockNumber,
    }),
  ]);
  if (
    !vaultCode ||
    vaultCode === "0x" ||
    !factoryVault ||
    getAddress(vaultHook).toLowerCase() !== release.hook.toLowerCase() ||
    vaultPoolId.toLowerCase() !== reward.poolId.toLowerCase() ||
    beneficiaryCount < 1n ||
    beneficiaryCount > 5n ||
    disclosure[7].toLowerCase() !== reward.vaultAddress.toLowerCase() ||
    poolConfig[0].toLowerCase() !== reward.vaultAddress.toLowerCase() ||
    getAddress(poolConfig[1]).toLowerCase() !==
      release.launcher.toLowerCase() ||
    !poolConfig[4] ||
    Number(disclosure[0]) !== reward.buySwapFeeBps ||
    Number(disclosure[1]) !== reward.sellSwapFeeBps ||
    (reward.buyCreatorFeeBps !== null &&
      Number(disclosure[2]) !== reward.buyCreatorFeeBps) ||
    (reward.sellCreatorFeeBps !== null &&
      Number(disclosure[3]) !== reward.sellCreatorFeeBps) ||
    Number(disclosure[2]) + Number(disclosure[4]) !==
      Number(disclosure[0]) ||
    Number(disclosure[3]) + Number(disclosure[4]) !==
      Number(disclosure[1]) ||
    Number(disclosure[4]) !== reward.launcherFeeBps ||
    Number(disclosure[5]) !== reward.transferTaxBps ||
    Number(disclosure[6]) !== reward.lpFeePips ||
    Number(poolConfig[2]) !== reward.buySwapFeeBps ||
    Number(poolConfig[3]) !== reward.sellSwapFeeBps
  ) {
    throw new Error("Classic reward provenance does not match the indexed launch");
  }
  const allocations = await Promise.all(
    Array.from({ length: Number(beneficiaryCount) }, async (_, index) => {
      const [beneficiary, allocationShare] = await Promise.all([
        client.readContract({
          address: reward.vaultAddress,
          abi: classicRewardVaultAbi,
          functionName: "beneficiaryAt",
          args: [BigInt(index)],
          blockNumber,
        }),
        client.readContract({
          address: reward.vaultAddress,
          abi: classicRewardVaultAbi,
          functionName: "shareBpsAt",
          args: [BigInt(index)],
          blockNumber,
        }),
      ]);
      return {
        allocationIndex: index,
        payoutAddress: getAddress(beneficiary),
        shareBps: Number(allocationShare),
      };
    }),
  );
  if (
    new Set(allocations.map((item) => item.payoutAddress.toLowerCase())).size !==
      allocations.length ||
    allocations.some((item) => item.shareBps <= 0) ||
    allocations.reduce((sum, item) => sum + item.shareBps, 0) !== 10_000 ||
    allocations
      .filter(
        (item) => item.payoutAddress.toLowerCase() === account.toLowerCase(),
      )
      .reduce((sum, item) => sum + item.shareBps, 0) !== Number(shareBps)
  ) {
    throw new Error("Classic reward allocation is invalid");
  }
  const prospective = prospectiveAllocation(
    poolConfig[5],
    allocations,
    account,
  );
  const claimable = checkpointed + prospective;
  const ownsAllocation =
    allocationIndex === undefined
      ? false
      : allocations.some(
          (item) =>
            item.allocationIndex === allocationIndex &&
            item.payoutAddress.toLowerCase() === account.toLowerCase(),
        );
  return {
    claimableWei: claimable.toString(),
    claimedWei: claimed.toString(),
    shareBps: Number(shareBps),
    ownsAllocation,
    allocations: allocations.map((item) => ({
      ...item,
      payoutAddress: item.payoutAddress.toLowerCase(),
    })),
  };
}

async function readRewardsFromClient(
  account: Address,
  client: PublicClient,
  entries: readonly CanonicalTokenExploreEntry[],
) {
  const releases = configuredClassicActionReleases();
  if (releases.length === 0) {
    return {
      status: "not-deployed" as const,
      account,
      chainId: chain.id,
      rewards: [],
    };
  }
  const latestBlock = await client.getBlockNumber();
  const snapshotBlock =
    latestBlock > CONFIRMATIONS ? latestBlock - CONFIRMATIONS : latestBlock;
  await Promise.all(
    releases.flatMap((release) => [
      assertCodeHashAtBlock(
        client,
        release.launcher,
        release.launcherRuntimeCodeHash,
        snapshotBlock,
        `${release.releaseVersion} launcher`,
      ),
      assertCodeHashAtBlock(
        client,
        release.hook,
        release.hookRuntimeCodeHash,
        snapshotBlock,
        `${release.releaseVersion} hook`,
      ),
      assertCodeHashAtBlock(
        client,
        release.rewardVaultFactory,
        release.rewardVaultFactoryRuntimeCodeHash,
        snapshotBlock,
        "Classic reward factory",
      ),
    ]),
  );
  const identities = entries.flatMap(entry => {
    const release = releases.find(release => release.releaseVersion === entry.launchModelVersion);
    if (!release) return [];
    if (entry.launchModel !== "classic" || !entry.rewardVaultAddress || !entry.launchTransactionHash
      || !entry.launchBlockNumber || entry.buyHookFeeBps === undefined || entry.sellHookFeeBps === undefined
      || entry.hookAddress.toLowerCase() !== release.hook.toLowerCase()) {
      throw new Error("Classic catalog reward identity is incomplete");
    }
    if (BigInt(entry.launchBlockNumber) > snapshotBlock) return [];
    return [{ release, candidate: {
      token: entry.tokenAddress, rewardVault: entry.rewardVaultAddress, poolId: entry.poolId,
      feeHook: entry.hookAddress, buySwapFeeBps: entry.buyHookFeeBps, sellSwapFeeBps: entry.sellHookFeeBps,
      transactionHash: entry.launchTransactionHash,
    } }];
  });
  if (
    new Set(
      identities.map(({ candidate }) => getAddress(candidate.rewardVault).toLowerCase()),
    ).size !== identities.length
  ) {
    throw new Error("Classic reward vault identity is ambiguous");
  }

  const relevant = (
    await Promise.all(
      identities.map(async ({ release, candidate }) => {
        const vaultAddress = getAddress(candidate.rewardVault);
        const [share, checkpointed, claimed] = await Promise.all([
          client.readContract({
            address: vaultAddress,
            abi: classicRewardVaultAbi,
            functionName: "shareBpsOf",
            args: [account],
            blockNumber: snapshotBlock,
          }),
          client.readContract({
            address: vaultAddress,
            abi: classicRewardVaultAbi,
            functionName: "claimable",
            args: [account],
            blockNumber: snapshotBlock,
          }),
          client.readContract({
            address: vaultAddress,
            abi: classicRewardVaultAbi,
            functionName: "claimedBy",
            args: [account],
            blockNumber: snapshotBlock,
          }),
        ]);
        return Number(share) > 0 || checkpointed > 0n || claimed > 0n
          ? { release, candidate, share, checkpointed, claimed }
          : null;
      }),
    )
  ).filter((item) => item !== null);

  const rewards = await Promise.all(
    relevant.map(async ({ release, candidate, share, checkpointed, claimed }) => {
      const tokenAddress = getAddress(candidate.token);
      const vaultAddress = getAddress(candidate.rewardVault);
      const poolId = candidate.poolId;
      const [
        tokenName,
        tokenSymbol,
        beneficiaryCount,
        factoryVault,
        vaultHook,
        vaultPoolId,
        disclosure,
        poolConfig,
      ] = await Promise.all([
        client.readContract({
          address: tokenAddress,
          abi: uerc20ReadAbi,
          functionName: "name",
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: tokenAddress,
          abi: uerc20ReadAbi,
          functionName: "symbol",
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vaultAddress,
          abi: classicRewardVaultAbi,
          functionName: "beneficiaryCount",
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: release.rewardVaultFactory,
          abi: classicRewardVaultFactoryAbi,
          functionName: "isFactoryVault",
          args: [vaultAddress],
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vaultAddress,
          abi: classicRewardVaultAbi,
          functionName: "feeHook",
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: vaultAddress,
          abi: classicRewardVaultAbi,
          functionName: "poolId",
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: release.hook,
          abi: classicV3HookAbi,
          functionName: "feeDisclosure",
          args: [poolId],
          blockNumber: snapshotBlock,
        }),
        client.readContract({
          address: release.hook,
          abi: classicV3HookAbi,
          functionName: "poolFeeConfig",
          args: [poolId],
          blockNumber: snapshotBlock,
        }),
      ]);
      if (
        !factoryVault ||
        getAddress(candidate.feeHook).toLowerCase() !==
          release.hook.toLowerCase() ||
        getAddress(vaultHook).toLowerCase() !== release.hook.toLowerCase() ||
        vaultPoolId.toLowerCase() !== poolId.toLowerCase() ||
        disclosure[7].toLowerCase() !== vaultAddress.toLowerCase() ||
        poolConfig[0].toLowerCase() !== vaultAddress.toLowerCase() ||
        getAddress(poolConfig[1]).toLowerCase() !==
          release.launcher.toLowerCase() ||
        !poolConfig[4] ||
        Number(disclosure[0]) !== Number(candidate.buySwapFeeBps) ||
        Number(disclosure[1]) !== Number(candidate.sellSwapFeeBps) ||
        Number(disclosure[2]) + Number(disclosure[4]) !==
          Number(disclosure[0]) ||
        Number(disclosure[3]) + Number(disclosure[4]) !==
          Number(disclosure[1]) ||
        Number(disclosure[4]) !== 10 ||
        Number(disclosure[5]) !== 0 ||
        Number(disclosure[6]) !== 0 ||
        Number(poolConfig[2]) !== Number(disclosure[0]) ||
        Number(poolConfig[3]) !== Number(disclosure[1])
      ) {
        throw new Error("Classic reward configuration is inconsistent");
      }
      if (beneficiaryCount < 1n || beneficiaryCount > 5n) {
        throw new Error("Classic reward split is outside its bounds");
      }

      const beneficiaries = await Promise.all(
        Array.from({ length: Number(beneficiaryCount) }, async (_, index) => {
          const [payoutAddress, allocationShare] = await Promise.all([
            client.readContract({
              address: vaultAddress,
              abi: classicRewardVaultAbi,
              functionName: "beneficiaryAt",
              args: [BigInt(index)],
              blockNumber: snapshotBlock,
            }),
            client.readContract({
              address: vaultAddress,
              abi: classicRewardVaultAbi,
              functionName: "shareBpsAt",
              args: [BigInt(index)],
              blockNumber: snapshotBlock,
            }),
          ]);
          return {
            allocationIndex: index,
            beneficiary: getAddress(payoutAddress),
            payoutAddress: getAddress(payoutAddress),
            shareBps: Number(allocationShare),
          };
        }),
      );
      if (
        new Set(
          beneficiaries.map((item) => item.payoutAddress.toLowerCase()),
        ).size !== beneficiaries.length ||
        beneficiaries.some((item) => item.shareBps <= 0) ||
        beneficiaries.reduce((sum, item) => sum + item.shareBps, 0) !==
          10_000
      ) {
        throw new Error("Classic reward allocation is invalid");
      }
      const prospective = prospectiveAllocation(
        poolConfig[5],
        beneficiaries,
        account,
      );
      const claimable = checkpointed + prospective;
      const ownedAllocations = beneficiaries.filter(
        (item) =>
          item.payoutAddress.toLowerCase() === account.toLowerCase(),
      );
      if (
        ownedAllocations.reduce((sum, item) => sum + item.shareBps, 0) !==
          Number(share)
      ) {
        throw new Error("Classic reward allocation does not match the account");
      }

      return {
        releaseVersion: release.releaseVersion,
        tokenAddress,
        tokenName,
        tokenSymbol,
        poolId,
        vaultAddress,
        beneficiary: account,
        payoutAddress: account,
        shareBps: Number(share),
        ownedAllocations,
        claimableWei: claimable.toString(),
        claimableEth: formatUnits(claimable, 18),
        claimedWei: claimed.toString(),
        claimedEth: formatUnits(claimed, 18),
        buySwapFeeBps: disclosure[0],
        sellSwapFeeBps: disclosure[1],
        platformFeeBps: 10 as const,
        beneficiaries,
        launchTransactionHash: candidate.transactionHash,
      };
    }),
  );

  return {
    status: "ready" as const,
    account,
    chainId: chain.id,
    rewards,
  };
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some(
      (key) => key !== "account" && key !== "launch",
    ) ||
    search.getAll("account").length !== 1 ||
    search.getAll("launch").length > 1
  ) {
    return json({ error: "Unsupported query parameters" }, 400);
  }
  const input = search.get("account")?.trim();
  if (!input || !isAddress(input)) {
    return json({ error: "Enter a valid Ethereum account address" }, 400);
  }
  try {
    const launch = search.get("launch")?.trim();
    if (launch && (!isHex(launch, { strict: true }) || launch.length !== 66)) {
      return json({ error: "Enter a valid launch transaction hash" }, 400);
    }
    const catalog = await readClassicLaunchCatalogV1({ signal: request.signal, deadlineMs: Date.now()+12_000 });
    if (launch) {
      return NextResponse.json(readLaunchByTransaction(getAddress(input), launch as Hex, catalog.entries), {
        headers: { "Cache-Control": "private, max-age=0, s-maxage=15", "X-Programmable-Read-Source": "codex" },
      });
    }
    const deployment = classicActionDeployment();
    const result = await withOperationalRpcFailover(
      deployment,
      async (selected) => ({
        profile: await readRewardsFromClient(
          getAddress(input),
          createActionClient(selected.rpcUrl),
          catalog.entries,
        ),
        provider: classicRpcProviderHeader(deployment, selected.rpcUrl),
      }),
    );
    return NextResponse.json(
      result.profile,
      {
        headers: {
          "Cache-Control": "private, max-age=0, s-maxage=15",
          "X-Programmable-Read-Source": "codex",
          "X-Programmable-Rpc-Provider": result.provider,
        },
      },
    );
  } catch (error) {
    console.error(
      "Classic profile read failed",
      safeOperationalRpcError(error),
    );
    return json(classicV3ProfileApiError("temporary"), 503);
  }
}

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
    return json({ error: "The reward request is too large" }, 413);
  }

  let input: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return json({ error: "The reward request is too large" }, 413);
    }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Send a valid reward request" }, 400);
  }

  if (
    (input.action !== "claim" && input.action !== "update-payout") ||
    typeof input.account !== "string" ||
    !isAddress(input.account) ||
    typeof input.vaultAddress !== "string" ||
    !isAddress(input.vaultAddress) ||
    input.chainId !== chain.id
  ) {
    return json({ error: "The reward request is invalid" }, 400);
  }
  const account = getAddress(input.account);
  const vaultAddress = getAddress(input.vaultAddress);
  const action = input.action as "claim" | "update-payout";
  let newPayoutAddress: Address | undefined;
  let allocationIndex: number | undefined;
  if (action === "update-payout") {
    if (
      typeof input.allocationIndex !== "number" ||
      !Number.isSafeInteger(input.allocationIndex) ||
      input.allocationIndex < 0 ||
      input.allocationIndex >= 5 ||
      typeof input.newPayoutAddress !== "string" ||
      !isAddress(input.newPayoutAddress)
    ) {
      return json({ error: "Choose a valid reward allocation and payout address" }, 400);
    }
    allocationIndex = input.allocationIndex;
    newPayoutAddress = getAddress(input.newPayoutAddress);
  }

  try {
    const catalog = await readClassicLaunchCatalogV1({
      signal: request.signal,
      deadlineMs: Date.now() + 7_000,
    });
    const catalogRewards = catalog.entries.filter(
      (candidate): candidate is CanonicalTokenExploreEntry =>
        candidate.exploreKind === "token" &&
        candidate.rewardVaultAddress?.toLowerCase() ===
          vaultAddress.toLowerCase(),
    );
    const catalogReward = catalogRewards.length === 1
      ? catalogRewards[0]
      : null;
    if (
      !catalogReward ||
      catalogReward.rewardVaultAddress === undefined ||
      (catalogReward.launchModelVersion !== "classic-v3" &&
        catalogReward.launchModelVersion !== "classic-v4") ||
      !isAddress(catalogReward.hookAddress) ||
      !isHex(catalogReward.poolId, { strict: true }) ||
      catalogReward.poolId.length !== 66 ||
      typeof catalogReward.buyHookFeeBps !== "number" ||
      !Number.isSafeInteger(catalogReward.buyHookFeeBps) ||
      typeof catalogReward.sellHookFeeBps !== "number" ||
      !Number.isSafeInteger(catalogReward.sellHookFeeBps) ||
      typeof catalogReward.lpFeePips !== "number" ||
      !Number.isSafeInteger(catalogReward.lpFeePips)
    ) {
      return json(
        { error: "Only a current or historic payout wallet can continue" },
        403,
      );
    }
    const release = catalogReward.launchModelVersion === "classic-v3"
      ? configuredClassicV3ActionRelease()
      : configuredClassicActionReleases(true).find(
          (candidate) => candidate.releaseVersion === "classic-v4",
        ) ?? null;
    if (!release) {
      return json({ error: "This Classic release is not active" }, 409);
    }
    if (
      getAddress(catalogReward.hookAddress).toLowerCase() !==
        release.hook.toLowerCase()
    ) {
      return json(
        { error: "Only a current or historic payout wallet can continue" },
        403,
      );
    }
    const reward: ClassicActionRewardIdentity = {
      vaultAddress: getAddress(catalogReward.rewardVaultAddress),
      poolId: catalogReward.poolId,
      buySwapFeeBps: catalogReward.buyHookFeeBps,
      sellSwapFeeBps: catalogReward.sellHookFeeBps,
      buyCreatorFeeBps: null,
      sellCreatorFeeBps: null,
      launcherFeeBps: 10,
      transferTaxBps: 0,
      lpFeePips: catalogReward.lpFeePips,
    };
    const deployment = classicActionDeployment();
    const prepared = await withOperationalRpcFailover(
      deployment,
      async (selected) => {
        const client = createActionClient(selected.rpcUrl);
        const blockNumber = await currentActionBlock(client);
        const actionState = await readClassicActionState({
          client,
          release,
          reward,
          account,
          blockNumber,
          allocationIndex,
        });
        if (
          action === "update-payout" &&
          !actionState.ownsAllocation
        ) {
          return {
            status: 403,
            body: {
              error:
                "Only the current owner of this reward allocation can change it",
            },
          } as const;
        }
        if (
          action === "claim" &&
          BigInt(actionState.claimableWei) === 0n
        ) {
          return {
            status: 409,
            body: { error: "There are no rewards to claim" },
          } as const;
        }
        const data = encodeClassicV3RewardAction({
          action,
          allocationIndex,
          newPayoutAddress,
        });
        const transaction = {
          account,
          to: vaultAddress,
          data,
          value: 0n,
        };
        await client.call(transaction);
        const [estimatedGas, gasPrice, balance] = await Promise.all([
          client.estimateGas(transaction),
          client.getGasPrice(),
          client.getBalance({ address: account }),
        ]);
        const gasLimit = (estimatedGas * 120n + 99n) / 100n;
        if (balance < gasLimit * gasPrice) {
          return {
            status: 409,
            body: {
              error: "This wallet needs more ETH for the network fee",
            },
          } as const;
        }
        const kind =
          action === "claim"
            ? "claim-classic-v3-rewards"
            : "update-classic-v3-payout";
        return {
          status: 200,
          body: {
            status: "ready",
            action,
            releaseVersion: release.releaseVersion,
            account,
            vaultAddress,
            transaction: {
              kind,
              chainId: chain.id,
              from: account,
              to: vaultAddress,
              data,
              value: "0",
              gasLimit: gasLimit.toString(),
            },
          },
        } as const;
      },
    );
    return json(prepared.body, prepared.status);
  } catch (error) {
    console.error(
      "Classic reward preparation failed",
      safeOperationalRpcError(error),
    );
    return json(
      { error: "The reward action could not be simulated from current onchain state" },
      502,
    );
  }
}
