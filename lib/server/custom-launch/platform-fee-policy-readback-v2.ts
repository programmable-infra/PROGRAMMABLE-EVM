import "server-only";

import {
  bytesToHex,
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  http,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import {
  LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
  LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH,
} from "../../alchemy/launch-stamp.server";
import { stateViewReadAbi } from "../../onchain/abis";
import { getWebsiteReadOnchainDeployment } from "../../onchain/config";
import {
  isOperationalRpcFailoverEligible,
  safeOperationalRpcError,
  withOperationalRpcFailover,
} from "../../onchain/operational-rpc-failover.server";
import type { OnchainDeployment } from "../../onchain/types";
import {
  CANONICAL_LAUNCH_STAMP_V1,
  CANONICAL_PLATFORM_FEE_POLICY_V2,
  isLaunchStampProvenanceV1,
  isPlatformFeePolicyReadbackV2,
  type CanonicalTokenExploreEntry,
  type PlatformFeePolicyReadbackV2,
  type PlatformFeePolicyRuntimeRoleV2,
} from "../../tokens";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
const PLATFORM_FEE_RECIPIENT = getAddress(
  CANONICAL_PLATFORM_FEE_POLICY_V2.recipient,
);
const PLATFORM_FEE_RATE_PPM = CANONICAL_PLATFORM_FEE_POLICY_V2.ratePpm;
const PLATFORM_FEE_DENOMINATOR_PPM =
  CANONICAL_PLATFORM_FEE_POLICY_V2.denominatorPpm;
const REQUIRED_HOOK_FLAGS =
  CANONICAL_PLATFORM_FEE_POLICY_V2.requiredHookFlags;
const FEE_POLICY_DOMAIN = keccak256(
  stringToHex("programmable.custom-fee-policy.v2"),
);
const FEE_BASIS = keccak256(stringToHex(
  "programmable.fee-basis.v2.gross-unspecified-pool-currency-amount",
));
const FEE_ASSET_MODE = keccak256(stringToHex(
  "programmable.fee-asset-mode.v2.unspecified-pool-currency-per-swap",
));
const ZERO_CUSTOM_PROFILE = keccak256(
  stringToHex("programmable.fee-hook-profile.v2.zero-custom"),
);
const ISOLATED_AFTER_SWAP_PROFILE = keccak256(stringToHex(
  "programmable.fee-hook-profile.v2.isolated-after-swap-zero-delta-opcode-safe",
));
// Final fee-profile compiler artifact commitment. This is intentionally an
// exact released digest rather than a locally reconstructed settings label.
const COMPILER_SETTINGS_HASH =
  "0xd8985cd6554daab2848a8df4d90f9d5e0d81f15d062ee04bcd8414f292ccaf43" as Hex;
const DEPLOYMENT_PROFILE_DOMAIN = keccak256(
  stringToHex("programmable.fee-deployment-profile.v2"),
);
const COMPOSITION_DOMAIN = keccak256(
  stringToHex("programmable.fee-composition.v2"),
);
const POLICY_ID_PARAMETERS = parseAbiParameters(
  "bytes32,uint16,uint256,bytes32,bytes32,bytes32,uint24,uint24,address,uint160",
);
const DEPLOYMENT_PROFILE_PARAMETERS = parseAbiParameters(
  "bytes32,bytes32,bytes32,address,bytes32,address,bytes32,bytes32,bytes32,bytes32,bytes32,uint128",
);
const COMPOSITION_PARAMETERS = parseAbiParameters(
  "bytes32,bytes32,address,bytes32,address,bytes32,address,bytes32,bytes32,uint160,address,bytes32,address,bytes32,address,uint128",
);

const feeHookReadAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function graphDeployer() view returns (address)",
  "function platformFeeVault() view returns (address)",
  "function platformFeeAccrualContextHash() view returns (bytes32)",
  "function PLATFORM_FEE_PPM() view returns (uint24)",
  "function FEE_DENOMINATOR_PPM() view returns (uint24)",
  "function PLATFORM_FEE_RECIPIENT() view returns (address)",
  "function REQUIRED_HOOK_FLAGS() view returns (uint160)",
  "function feePolicyVersion() view returns (uint16)",
  "function feePolicyChainId() view returns (uint256)",
  "function feePolicyId() view returns (bytes32)",
  "function feePolicyProfile() view returns (bytes32)",
  "function feePolicyBasis() view returns (bytes32)",
  "function feePolicyAssetMode() view returns (bytes32)",
  "function feePolicyRatePpm() view returns (uint24)",
  "function feePolicyDenominatorPpm() view returns (uint24)",
  "function feePolicyRecipient() view returns (address)",
  "function feePolicyRequiredHookFlags() view returns (uint160)",
  "function feePolicyCustomModule() view returns (address)",
  "function feePolicyCustomModuleRuntimeCodeHash() view returns (bytes32)",
  "function feePolicyCustomDeltaAccount() view returns (address)",
  "function feePolicyMaximumCustomDeltaAbsolute() view returns (uint128)",
  "function poolBindingComplete() view returns (bool)",
  "function poolInitialized() view returns (bool)",
  "function authorizedInitializer() view returns (address)",
  "function authorizedInitializerRuntimeCodeHash() view returns (bytes32)",
  "function boundPoolId() view returns (bytes32)",
  "function boundInitialSqrtPriceX96() view returns (uint160)",
  "function boundToken() view returns (address)",
  "function boundHookRuntimeCodeHash() view returns (bytes32)",
  "function boundVaultRuntimeCodeHash() view returns (bytes32)",
  "function boundTokenRuntimeCodeHash() view returns (bytes32)",
  "function deploymentProfileHash() view returns (bytes32)",
  "function compositionHash() view returns (bytes32)",
  "function getHookPermissions() view returns ((bool beforeInitialize,bool afterInitialize,bool beforeAddLiquidity,bool afterAddLiquidity,bool beforeRemoveLiquidity,bool afterRemoveLiquidity,bool beforeSwap,bool afterSwap,bool beforeDonate,bool afterDonate,bool beforeSwapReturnDelta,bool afterSwapReturnDelta,bool afterAddLiquidityReturnDelta,bool afterRemoveLiquidityReturnDelta) permissions)",
]);

const feeVaultReadAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function graphDeployer() view returns (address)",
  "function bindingAuthority() view returns (address)",
  "function authorizedAdapter() view returns (address)",
  "function authorizedAdapterCodeHash() view returns (bytes32)",
  "function PLATFORM_FEE_PPM() view returns (uint24)",
  "function FEE_DENOMINATOR_PPM() view returns (uint24)",
  "function PLATFORM_FEE_RECIPIENT() view returns (address)",
  "function requiredAdapterFlags() view returns (uint160)",
  "function canonicalPoolManagerRuntimeCodeHash() view returns (bytes32)",
  "function canonicalGraphDeployerRuntimeCodeHash() view returns (bytes32)",
  "function pendingPlatformFeeFunding(address currency) view returns (uint256)",
  "function pendingPlatformFeeContextHash(address currency) view returns (bytes32)",
]);

const feeInitializerReadAbi = parseAbi([
  "function graphDeployer() view returns (address)",
  "function poolManager() view returns (address)",
  "function platformFeeVault() view returns (address)",
  "function feeHook() view returns (address)",
  "function token() view returns (address)",
  "function poolFee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function initialSqrtPriceX96() view returns (uint160)",
  "function initialized() view returns (bool)",
  "function initializedPoolId() view returns (bytes32)",
  "function initializedTick() view returns (int24)",
  "function poolKey() view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)",
  "function poolId() view returns (bytes32)",
]);

export type PlatformFeeRuntimeImmutableSourceV2 =
  | "pool-manager"
  | "graph-deployer"
  | "vault"
  | "hook"
  | "token"
  | "pool-fee"
  | "tick-spacing"
  | "initial-sqrt-price-x96"
  | "expected-policy-id"
  | "custom-module"
  | "custom-module-runtime-code-hash"
  | "custom-delta-account"
  | "maximum-custom-delta-absolute";

export type PlatformFeeRuntimeTemplateV2 = Readonly<{
  normalizedRuntimeBytecode: Hex;
  normalizedRuntimeCodeHash: Hex;
  immutableBindings: readonly Readonly<{
    source: PlatformFeeRuntimeImmutableSourceV2;
    references: readonly Readonly<{ start: number; length: 32 }>[];
  }>[];
}>;

export type PlatformFeeProfileBuildV2 = Readonly<{
  schemaVersion: "programmable.platform-fee-profile-build.v2";
  status: "active";
  profileBuildId: `sha256:${string}`;
  sourceBundleDigest: `sha256:${string}`;
  compilerArtifactDigest: `sha256:${string}`;
  compilerSettingsHash: Hex;
  profile: "zero-custom" | "isolated-after-swap-zero-delta-opcode-safe";
  routeLauncher: Readonly<{
    address: Address;
    runtimeCodeHash: Hex;
  }>;
  policy: Readonly<{
    version: 2;
    chainId: 1;
    id: Hex;
    profileId: Hex;
    basisId: Hex;
    assetModeId: Hex;
    ratePpm: 1000;
    denominatorPpm: 1_000_000;
    recipient: Address;
    requiredHookFlags: 0x2044;
  }>;
  runtimeTemplates: Readonly<{
    token: PlatformFeeRuntimeTemplateV2;
    vault: PlatformFeeRuntimeTemplateV2;
    hook: PlatformFeeRuntimeTemplateV2;
    initializer: PlatformFeeRuntimeTemplateV2;
  }>;
}>;

/**
 * Deliberately empty until one exact source/compiler build and its canonical
 * route-launcher binding are released. Getter-shaped contracts are never
 * enough to activate this surface.
 */
export const PRODUCTION_PLATFORM_FEE_PROFILE_BUILDS_V2 = Object.freeze(
  [] as readonly PlatformFeeProfileBuildV2[],
);

type FeeReadClient = Pick<
  PublicClient,
  "getBlock" | "getChainId" | "getCode" | "readContract"
>;

type SnapshotBoundary = Readonly<{
  asOfBlock: string;
  asOfBlockHash: Hex;
  finalityConfirmations: number;
}>;

type RuntimeContext = Readonly<{
  poolManager: Address;
  graphDeployer: Address;
  vault: Address;
  hook: Address;
  token: Address;
  poolFee: bigint;
  tickSpacing: bigint;
  initialSqrtPriceX96: bigint;
  expectedPolicyId: Hex;
  customModule: Address;
  customModuleRuntimeCodeHash: Hex;
  customDeltaAccount: Address;
  maximumCustomDeltaAbsolute: bigint;
}>;

type HookState = Readonly<{
  poolManager: Address;
  graphDeployer: Address;
  vault: Address;
  accrualContextHash: Hex;
  platformFeePpm: bigint;
  feeDenominatorPpm: bigint;
  platformFeeRecipient: Address;
  requiredHookFlags: bigint;
  policyVersion: bigint;
  policyChainId: bigint;
  policyId: Hex;
  policyProfile: Hex;
  policyBasis: Hex;
  policyAssetMode: Hex;
  policyRatePpm: bigint;
  policyDenominatorPpm: bigint;
  policyRecipient: Address;
  policyRequiredHookFlags: bigint;
  customModule: Address;
  customModuleRuntimeCodeHash: Hex;
  customDeltaAccount: Address;
  maximumCustomDeltaAbsolute: bigint;
  poolBindingComplete: boolean;
  poolInitialized: boolean;
  authorizedInitializer: Address;
  authorizedInitializerRuntimeCodeHash: Hex;
  boundPoolId: Hex;
  boundInitialSqrtPriceX96: bigint;
  boundToken: Address;
  boundHookRuntimeCodeHash: Hex;
  boundVaultRuntimeCodeHash: Hex;
  boundTokenRuntimeCodeHash: Hex;
  deploymentProfileHash: Hex;
  compositionHash: Hex;
  permissions: unknown;
}>;

type InitializerState = Readonly<{
  graphDeployer: Address;
  poolManager: Address;
  vault: Address;
  hook: Address;
  token: Address;
  poolFee: bigint;
  tickSpacing: bigint;
  initialSqrtPriceX96: bigint;
  initialized: boolean;
  initializedPoolId: Hex;
  initializedTick: bigint;
  poolKey: unknown;
  poolId: Hex;
}>;

class PlatformFeePolicyIntegrityError extends Error {
  override name = "PlatformFeePolicyIntegrityError";
}

function fail(): never {
  throw new PlatformFeePolicyIntegrityError(
    "Platform fee policy evidence did not match its trusted build",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/iu.test(value);
}

function isNonZeroBytes32(value: unknown): value is Hex {
  return isBytes32(value) && BigInt(value) !== 0n;
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameAddress(left: string, right: string) {
  return sameHex(left, right);
}

function profileIdForBuild(profile: PlatformFeeProfileBuildV2["profile"]) {
  return profile === "zero-custom"
    ? ZERO_CUSTOM_PROFILE
    : ISOLATED_AFTER_SWAP_PROFILE;
}

function policyIdForProfile(profileId: Hex) {
  return keccak256(encodeAbiParameters(POLICY_ID_PARAMETERS, [
    FEE_POLICY_DOMAIN,
    2,
    1n,
    profileId,
    FEE_BASIS,
    FEE_ASSET_MODE,
    PLATFORM_FEE_RATE_PPM,
    PLATFORM_FEE_DENOMINATOR_PPM,
    PLATFORM_FEE_RECIPIENT,
    BigInt(REQUIRED_HOOK_FLAGS),
  ]));
}

function immutableSource(
  value: unknown,
): value is PlatformFeeRuntimeImmutableSourceV2 {
  return value === "pool-manager" ||
    value === "graph-deployer" ||
    value === "vault" ||
    value === "hook" ||
    value === "token" ||
    value === "pool-fee" ||
    value === "tick-spacing" ||
    value === "initial-sqrt-price-x96" ||
    value === "expected-policy-id" ||
    value === "custom-module" ||
    value === "custom-module-runtime-code-hash" ||
    value === "custom-delta-account" ||
    value === "maximum-custom-delta-absolute";
}

const ALLOWED_TEMPLATE_SOURCES = Object.freeze({
  token: new Set<PlatformFeeRuntimeImmutableSourceV2>(),
  vault: new Set<PlatformFeeRuntimeImmutableSourceV2>([
    "pool-manager",
    "graph-deployer",
  ]),
  hook: new Set<PlatformFeeRuntimeImmutableSourceV2>([
    "pool-manager",
    "vault",
    "custom-module",
    "custom-module-runtime-code-hash",
    "custom-delta-account",
    "maximum-custom-delta-absolute",
  ]),
  initializer: new Set<PlatformFeeRuntimeImmutableSourceV2>([
    "graph-deployer",
    "pool-manager",
    "vault",
    "hook",
    "token",
    "pool-fee",
    "tick-spacing",
    "initial-sqrt-price-x96",
    "expected-policy-id",
  ]),
});

function parseRuntimeTemplate(
  value: unknown,
  role: keyof typeof ALLOWED_TEMPLATE_SOURCES,
): PlatformFeeRuntimeTemplateV2 {
  if (
    !isRecord(value) ||
    typeof value.normalizedRuntimeBytecode !== "string" ||
    !isHex(value.normalizedRuntimeBytecode, { strict: true }) ||
    value.normalizedRuntimeBytecode === "0x" ||
    !isNonZeroBytes32(value.normalizedRuntimeCodeHash) ||
    !Array.isArray(value.immutableBindings)
  ) fail();

  const template = value.normalizedRuntimeBytecode as Hex;
  const bytes = hexToBytes(template);
  if (!sameHex(keccak256(template), value.normalizedRuntimeCodeHash)) fail();
  const occupied = new Set<number>();
  const sources = new Set<PlatformFeeRuntimeImmutableSourceV2>();
  const bindings = value.immutableBindings.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !immutableSource(candidate.source) ||
      !ALLOWED_TEMPLATE_SOURCES[role].has(candidate.source) ||
      sources.has(candidate.source) ||
      !Array.isArray(candidate.references) ||
      candidate.references.length === 0
    ) fail();
    sources.add(candidate.source);
    const references = candidate.references.map((reference) => {
      if (
        !isRecord(reference) ||
        !Number.isSafeInteger(reference.start) ||
        Number(reference.start) < 0 ||
        reference.length !== 32 ||
        Number(reference.start) + 32 > bytes.length
      ) fail();
      const start = Number(reference.start);
      for (let index = start; index < start + 32; index += 1) {
        if (occupied.has(index) || bytes[index] !== 0) fail();
        occupied.add(index);
      }
      return Object.freeze({ start, length: 32 as const });
    });
    return Object.freeze({
      source: candidate.source,
      references: Object.freeze(references),
    });
  });
  return Object.freeze({
    normalizedRuntimeBytecode: template,
    normalizedRuntimeCodeHash: value.normalizedRuntimeCodeHash,
    immutableBindings: Object.freeze(bindings),
  });
}

export function parsePlatformFeeProfileBuildsV2(
  value: unknown,
): readonly PlatformFeeProfileBuildV2[] {
  if (!Array.isArray(value)) fail();
  const buildIds = new Set<string>();
  const builds = value.map((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate.schemaVersion !== "programmable.platform-fee-profile-build.v2" ||
      candidate.status !== "active" ||
      !isSha256(candidate.profileBuildId) ||
      buildIds.has(candidate.profileBuildId) ||
      !isSha256(candidate.sourceBundleDigest) ||
      !isSha256(candidate.compilerArtifactDigest) ||
      !isBytes32(candidate.compilerSettingsHash) ||
      !sameHex(candidate.compilerSettingsHash, COMPILER_SETTINGS_HASH) ||
      (candidate.profile !== "zero-custom" &&
        candidate.profile !== "isolated-after-swap-zero-delta-opcode-safe") ||
      !isRecord(candidate.routeLauncher) ||
      typeof candidate.routeLauncher.address !== "string" ||
      !isAddress(candidate.routeLauncher.address) ||
      !sameAddress(
        candidate.routeLauncher.address,
        CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryAddress,
      ) ||
      !isNonZeroBytes32(candidate.routeLauncher.runtimeCodeHash) ||
      !sameHex(
        candidate.routeLauncher.runtimeCodeHash,
        CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryRuntimeCodeHash,
      ) ||
      !isRecord(candidate.policy) ||
      candidate.policy.version !== 2 ||
      candidate.policy.chainId !== 1 ||
      !isNonZeroBytes32(candidate.policy.id) ||
      !isNonZeroBytes32(candidate.policy.profileId) ||
      !sameHex(
        candidate.policy.profileId,
        profileIdForBuild(candidate.profile),
      ) ||
      !sameHex(
        candidate.policy.id,
        policyIdForProfile(candidate.policy.profileId),
      ) ||
      !isBytes32(candidate.policy.basisId) ||
      !sameHex(candidate.policy.basisId, FEE_BASIS) ||
      !isBytes32(candidate.policy.assetModeId) ||
      !sameHex(candidate.policy.assetModeId, FEE_ASSET_MODE) ||
      candidate.policy.ratePpm !== PLATFORM_FEE_RATE_PPM ||
      candidate.policy.denominatorPpm !== PLATFORM_FEE_DENOMINATOR_PPM ||
      typeof candidate.policy.recipient !== "string" ||
      !isAddress(candidate.policy.recipient) ||
      !sameAddress(candidate.policy.recipient, PLATFORM_FEE_RECIPIENT) ||
      candidate.policy.requiredHookFlags !== REQUIRED_HOOK_FLAGS ||
      !isRecord(candidate.runtimeTemplates)
    ) fail();
    buildIds.add(candidate.profileBuildId);
    const runtimeTemplates = Object.freeze({
      token: parseRuntimeTemplate(candidate.runtimeTemplates.token, "token"),
      vault: parseRuntimeTemplate(candidate.runtimeTemplates.vault, "vault"),
      hook: parseRuntimeTemplate(candidate.runtimeTemplates.hook, "hook"),
      initializer: parseRuntimeTemplate(
        candidate.runtimeTemplates.initializer,
        "initializer",
      ),
    });
    return Object.freeze({
      schemaVersion: candidate.schemaVersion,
      status: candidate.status,
      profileBuildId: candidate.profileBuildId,
      sourceBundleDigest: candidate.sourceBundleDigest,
      compilerArtifactDigest: candidate.compilerArtifactDigest,
      compilerSettingsHash: candidate.compilerSettingsHash,
      profile: candidate.profile,
      routeLauncher: Object.freeze({
        address: getAddress(candidate.routeLauncher.address),
        runtimeCodeHash: candidate.routeLauncher.runtimeCodeHash,
      }),
      policy: Object.freeze({
        version: 2 as const,
        chainId: 1 as const,
        id: candidate.policy.id,
        profileId: candidate.policy.profileId,
        basisId: candidate.policy.basisId as Hex,
        assetModeId: candidate.policy.assetModeId as Hex,
        ratePpm: PLATFORM_FEE_RATE_PPM,
        denominatorPpm: PLATFORM_FEE_DENOMINATOR_PPM,
        recipient: getAddress(candidate.policy.recipient),
        requiredHookFlags: REQUIRED_HOOK_FLAGS,
      }),
      runtimeTemplates,
    }) satisfies PlatformFeeProfileBuildV2;
  });
  return Object.freeze(builds);
}

function immutableWord(
  source: PlatformFeeRuntimeImmutableSourceV2,
  context: RuntimeContext,
) {
  const raw = source === "pool-manager"
    ? BigInt(context.poolManager)
    : source === "graph-deployer"
      ? BigInt(context.graphDeployer)
      : source === "vault"
        ? BigInt(context.vault)
        : source === "hook"
          ? BigInt(context.hook)
          : source === "token"
            ? BigInt(context.token)
            : source === "pool-fee"
              ? context.poolFee
              : source === "tick-spacing"
                ? context.tickSpacing
                : source === "initial-sqrt-price-x96"
                  ? context.initialSqrtPriceX96
                  : source === "expected-policy-id"
                    ? BigInt(context.expectedPolicyId)
                    : source === "custom-module"
                      ? BigInt(context.customModule)
                      : source === "custom-module-runtime-code-hash"
                        ? BigInt(context.customModuleRuntimeCodeHash)
                        : source === "custom-delta-account"
                          ? BigInt(context.customDeltaAccount)
                          : context.maximumCustomDeltaAbsolute;
  if (raw < 0n || raw >= 1n << 256n) fail();
  const word = new Uint8Array(32);
  let remaining = raw;
  for (let index = 31; index >= 0; index -= 1) {
    word[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return word;
}

export function materializePlatformFeeRuntimeV2(
  template: PlatformFeeRuntimeTemplateV2,
  context: RuntimeContext,
): Hex {
  const bytes = hexToBytes(template.normalizedRuntimeBytecode);
  for (const binding of template.immutableBindings) {
    const word = immutableWord(binding.source, context);
    for (const reference of binding.references) {
      bytes.set(word, reference.start);
    }
  }
  return bytesToHex(bytes);
}

function exactRuntimeMatch(
  actual: Hex,
  template: PlatformFeeRuntimeTemplateV2,
  context: RuntimeContext,
) {
  return sameHex(actual, materializePlatformFeeRuntimeV2(template, context));
}

export function derivePlatformFeeDeploymentProfileHashV2(
  build: PlatformFeeProfileBuildV2,
  input: Readonly<{
    hookRuntimeCodeHash: Hex;
    vaultRuntimeCodeHash: Hex;
    tokenRuntimeCodeHash: Hex;
    customModuleRuntimeCodeHash: Hex;
  }>,
) {
  return keccak256(encodeAbiParameters(DEPLOYMENT_PROFILE_PARAMETERS, [
    DEPLOYMENT_PROFILE_DOMAIN,
    build.policy.id,
    COMPILER_SETTINGS_HASH,
    LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
    LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH,
    getAddress(CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryAddress),
    CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryRuntimeCodeHash,
    input.hookRuntimeCodeHash,
    input.vaultRuntimeCodeHash,
    input.tokenRuntimeCodeHash,
    input.customModuleRuntimeCodeHash,
    0n,
  ]));
}

export function derivePlatformFeeCompositionHashV2(input: Readonly<{
  deploymentProfileHash: Hex;
  hook: Address;
  hookRuntimeCodeHash: Hex;
  vault: Address;
  vaultRuntimeCodeHash: Hex;
  initializer: Address;
  initializerRuntimeCodeHash: Hex;
  poolId: Hex;
  initialSqrtPriceX96: bigint;
  token: Address;
  tokenRuntimeCodeHash: Hex;
  customModule: Address;
  customModuleRuntimeCodeHash: Hex;
}>) {
  return keccak256(encodeAbiParameters(COMPOSITION_PARAMETERS, [
    COMPOSITION_DOMAIN,
    input.deploymentProfileHash,
    input.hook,
    input.hookRuntimeCodeHash,
    input.vault,
    input.vaultRuntimeCodeHash,
    input.initializer,
    input.initializerRuntimeCodeHash,
    input.poolId,
    input.initialSqrtPriceX96,
    input.token,
    input.tokenRuntimeCodeHash,
    input.customModule,
    input.customModuleRuntimeCodeHash,
    ZERO_ADDRESS,
    0n,
  ]));
}

function customModuleRuntimeIsOpcodeSafe(runtime: Hex) {
  const bytes = hexToBytes(runtime);
  let cursor = 0;
  while (cursor < bytes.length) {
    const opcode = bytes[cursor]!;
    if (opcode === 0xf2 || opcode === 0xf4 || opcode === 0xff) return false;
    cursor += opcode >= 0x60 && opcode <= 0x7f
      ? opcode - 0x5f + 1
      : 1;
  }
  return true;
}

function tupleField(value: unknown, name: string, index: number): unknown {
  if (isRecord(value) && name in value) return value[name];
  return Array.isArray(value) ? value[index] : undefined;
}

function addressValue(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) fail();
  return getAddress(value);
}

function bigintValue(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  fail();
}

async function readHookState(
  client: FeeReadClient,
  address: Address,
  blockNumber: bigint,
): Promise<HookState> {
  const read = (functionName: string) => client.readContract({
    address,
    abi: feeHookReadAbi,
    functionName: functionName as never,
    blockNumber,
  });
  const values = await Promise.all([
    read("poolManager"),
    read("graphDeployer"),
    read("platformFeeVault"),
    read("platformFeeAccrualContextHash"),
    read("PLATFORM_FEE_PPM"),
    read("FEE_DENOMINATOR_PPM"),
    read("PLATFORM_FEE_RECIPIENT"),
    read("REQUIRED_HOOK_FLAGS"),
    read("feePolicyVersion"),
    read("feePolicyChainId"),
    read("feePolicyId"),
    read("feePolicyProfile"),
    read("feePolicyBasis"),
    read("feePolicyAssetMode"),
    read("feePolicyRatePpm"),
    read("feePolicyDenominatorPpm"),
    read("feePolicyRecipient"),
    read("feePolicyRequiredHookFlags"),
    read("feePolicyCustomModule"),
    read("feePolicyCustomModuleRuntimeCodeHash"),
    read("feePolicyCustomDeltaAccount"),
    read("feePolicyMaximumCustomDeltaAbsolute"),
    read("poolBindingComplete"),
    read("poolInitialized"),
    read("authorizedInitializer"),
    read("authorizedInitializerRuntimeCodeHash"),
    read("boundPoolId"),
    read("boundInitialSqrtPriceX96"),
    read("boundToken"),
    read("boundHookRuntimeCodeHash"),
    read("boundVaultRuntimeCodeHash"),
    read("boundTokenRuntimeCodeHash"),
    read("deploymentProfileHash"),
    read("compositionHash"),
    read("getHookPermissions"),
  ]);
  if (
    !isBytes32(values[3]) ||
    !isBytes32(values[10]) ||
    !isBytes32(values[11]) ||
    !isBytes32(values[12]) ||
    !isBytes32(values[13]) ||
    !isBytes32(values[19]) ||
    typeof values[22] !== "boolean" ||
    typeof values[23] !== "boolean" ||
    !isBytes32(values[25]) ||
    !isBytes32(values[26]) ||
    !isBytes32(values[29]) ||
    !isBytes32(values[30]) ||
    !isBytes32(values[31]) ||
    !isBytes32(values[32]) ||
    !isBytes32(values[33])
  ) fail();
  return Object.freeze({
    poolManager: addressValue(values[0]),
    graphDeployer: addressValue(values[1]),
    vault: addressValue(values[2]),
    accrualContextHash: values[3],
    platformFeePpm: bigintValue(values[4]),
    feeDenominatorPpm: bigintValue(values[5]),
    platformFeeRecipient: addressValue(values[6]),
    requiredHookFlags: bigintValue(values[7]),
    policyVersion: bigintValue(values[8]),
    policyChainId: bigintValue(values[9]),
    policyId: values[10],
    policyProfile: values[11],
    policyBasis: values[12],
    policyAssetMode: values[13],
    policyRatePpm: bigintValue(values[14]),
    policyDenominatorPpm: bigintValue(values[15]),
    policyRecipient: addressValue(values[16]),
    policyRequiredHookFlags: bigintValue(values[17]),
    customModule: addressValue(values[18]),
    customModuleRuntimeCodeHash: values[19],
    customDeltaAccount: addressValue(values[20]),
    maximumCustomDeltaAbsolute: bigintValue(values[21]),
    poolBindingComplete: values[22],
    poolInitialized: values[23],
    authorizedInitializer: addressValue(values[24]),
    authorizedInitializerRuntimeCodeHash: values[25],
    boundPoolId: values[26],
    boundInitialSqrtPriceX96: bigintValue(values[27]),
    boundToken: addressValue(values[28]),
    boundHookRuntimeCodeHash: values[29],
    boundVaultRuntimeCodeHash: values[30],
    boundTokenRuntimeCodeHash: values[31],
    deploymentProfileHash: values[32],
    compositionHash: values[33],
    permissions: values[34],
  });
}

async function readInitializerState(
  client: FeeReadClient,
  address: Address,
  blockNumber: bigint,
): Promise<InitializerState> {
  const read = (functionName: string) => client.readContract({
    address,
    abi: feeInitializerReadAbi,
    functionName: functionName as never,
    blockNumber,
  });
  const values = await Promise.all([
    read("graphDeployer"),
    read("poolManager"),
    read("platformFeeVault"),
    read("feeHook"),
    read("token"),
    read("poolFee"),
    read("tickSpacing"),
    read("initialSqrtPriceX96"),
    read("initialized"),
    read("initializedPoolId"),
    read("initializedTick"),
    read("poolKey"),
    read("poolId"),
  ]);
  if (
    typeof values[8] !== "boolean" ||
    !isBytes32(values[9]) ||
    !isBytes32(values[12])
  ) fail();
  return Object.freeze({
    graphDeployer: addressValue(values[0]),
    poolManager: addressValue(values[1]),
    vault: addressValue(values[2]),
    hook: addressValue(values[3]),
    token: addressValue(values[4]),
    poolFee: bigintValue(values[5]),
    tickSpacing: bigintValue(values[6]),
    initialSqrtPriceX96: bigintValue(values[7]),
    initialized: values[8],
    initializedPoolId: values[9],
    initializedTick: bigintValue(values[10]),
    poolKey: values[11],
    poolId: values[12],
  });
}

function exactPermissions(value: unknown) {
  const names = [
    "beforeInitialize",
    "afterInitialize",
    "beforeAddLiquidity",
    "afterAddLiquidity",
    "beforeRemoveLiquidity",
    "afterRemoveLiquidity",
    "beforeSwap",
    "afterSwap",
    "beforeDonate",
    "afterDonate",
    "beforeSwapReturnDelta",
    "afterSwapReturnDelta",
    "afterAddLiquidityReturnDelta",
    "afterRemoveLiquidityReturnDelta",
  ] as const;
  return names.every((name, index) => {
    const observed = tupleField(value, name, index);
    return observed === (
      name === "beforeInitialize" ||
      name === "afterSwap" ||
      name === "afterSwapReturnDelta"
    );
  });
}

function exactPoolKey(
  value: unknown,
  entry: CanonicalTokenExploreEntry,
) {
  const stamp = entry.launchStampProvenance!;
  const expected = stamp.poolKey;
  const currency0 = tupleField(value, "currency0", 0);
  const currency1 = tupleField(value, "currency1", 1);
  const fee = tupleField(value, "fee", 2);
  const tickSpacing = tupleField(value, "tickSpacing", 3);
  const hooks = tupleField(value, "hooks", 4);
  return typeof currency0 === "string" &&
    typeof currency1 === "string" &&
    typeof hooks === "string" &&
    sameAddress(currency0, expected.currency0) &&
    sameAddress(currency1, expected.currency1) &&
    sameAddress(hooks, expected.hooks) &&
    bigintValue(fee) === BigInt(expected.fee) &&
    bigintValue(tickSpacing) === BigInt(expected.tickSpacing);
}

function runtimeContext(
  input: Readonly<{
    entry: CanonicalTokenExploreEntry;
    build: PlatformFeeProfileBuildV2;
    vault: Address;
    hookState: HookState;
    initializer?: InitializerState;
  }>,
): RuntimeContext {
  const initializer = input.initializer;
  const stamp = input.entry.launchStampProvenance!;
  return Object.freeze({
    poolManager: getAddress(stamp.poolManagerAddress),
    graphDeployer: getAddress(stamp.routeLauncherAddress),
    vault: input.vault,
    hook: getAddress(input.entry.hookAddress),
    token: getAddress(input.entry.tokenAddress),
    poolFee: BigInt(initializer?.poolFee ?? stamp.poolKey.fee),
    tickSpacing: BigInt(initializer?.tickSpacing ?? stamp.poolKey.tickSpacing),
    initialSqrtPriceX96: initializer?.initialSqrtPriceX96 ?? 0n,
    expectedPolicyId: input.build.policy.id,
    customModule: input.hookState.customModule,
    customModuleRuntimeCodeHash:
      input.hookState.customModuleRuntimeCodeHash,
    customDeltaAccount: input.hookState.customDeltaAccount,
    maximumCustomDeltaAbsolute:
      input.hookState.maximumCustomDeltaAbsolute,
  });
}

async function exactCode(
  client: FeeReadClient,
  address: Address,
  expectedHash: Hex,
  blockNumber: bigint,
) {
  const code = await client.getCode({ address, blockNumber });
  if (
    !code ||
    code === "0x" ||
    !sameHex(keccak256(code), expectedHash)
  ) fail();
  return code;
}

async function readVaultSeal(
  client: FeeReadClient,
  input: Readonly<{
    vault: Address;
    hook: Address;
    hookRuntimeCodeHash: Hex;
    currency0: Address;
    currency1: Address;
    blockNumber: bigint;
  }>,
) {
  const read = (functionName: string, args?: readonly [Address]) =>
    client.readContract({
      address: input.vault,
      abi: feeVaultReadAbi,
      functionName: functionName as never,
      ...(args ? { args: args as never } : {}),
      blockNumber: input.blockNumber,
  });
  const values = await Promise.all([
    read("poolManager"),
    read("graphDeployer"),
    read("bindingAuthority"),
    read("authorizedAdapter"),
    read("authorizedAdapterCodeHash"),
    read("PLATFORM_FEE_PPM"),
    read("FEE_DENOMINATOR_PPM"),
    read("PLATFORM_FEE_RECIPIENT"),
    read("requiredAdapterFlags"),
    read("canonicalPoolManagerRuntimeCodeHash"),
    read("canonicalGraphDeployerRuntimeCodeHash"),
    read("pendingPlatformFeeFunding", [input.currency0]),
    read("pendingPlatformFeeContextHash", [input.currency0]),
    read("pendingPlatformFeeFunding", [input.currency1]),
    read("pendingPlatformFeeContextHash", [input.currency1]),
  ]);
  if (
    !isBytes32(values[4]) ||
    !isBytes32(values[9]) ||
    !isBytes32(values[10]) ||
    !isBytes32(values[12]) ||
    !isBytes32(values[14]) ||
    !sameAddress(addressValue(values[0]), LAUNCH_STAMP_POOL_MANAGER_ADDRESS) ||
    !sameAddress(
      addressValue(values[1]),
      CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryAddress,
    ) ||
    !sameAddress(addressValue(values[2]), ZERO_ADDRESS) ||
    !sameAddress(addressValue(values[3]), input.hook) ||
    !sameHex(values[4], input.hookRuntimeCodeHash) ||
    bigintValue(values[5]) !== BigInt(PLATFORM_FEE_RATE_PPM) ||
    bigintValue(values[6]) !== BigInt(PLATFORM_FEE_DENOMINATOR_PPM) ||
    !sameAddress(addressValue(values[7]), PLATFORM_FEE_RECIPIENT) ||
    bigintValue(values[8]) !== BigInt(REQUIRED_HOOK_FLAGS) ||
    !sameHex(values[9], LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH) ||
    !sameHex(
      values[10],
      CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryRuntimeCodeHash,
    ) ||
    bigintValue(values[11]) !== 0n ||
    values[12] !== ZERO_BYTES32 ||
    bigintValue(values[13]) !== 0n ||
    values[14] !== ZERO_BYTES32
  ) fail();
}

function assertHookPolicy(
  hook: HookState,
  build: PlatformFeeProfileBuildV2,
  vault: Address,
) {
  const zeroProfile = build.profile === "zero-custom";
  if (
    !sameAddress(hook.poolManager, LAUNCH_STAMP_POOL_MANAGER_ADDRESS) ||
    !sameAddress(
      hook.graphDeployer,
      CANONICAL_PLATFORM_FEE_POLICY_V2.graphFactoryAddress,
    ) ||
    !sameAddress(hook.vault, vault) ||
    hook.accrualContextHash !== ZERO_BYTES32 ||
    hook.platformFeePpm !== BigInt(PLATFORM_FEE_RATE_PPM) ||
    hook.feeDenominatorPpm !== BigInt(PLATFORM_FEE_DENOMINATOR_PPM) ||
    !sameAddress(hook.platformFeeRecipient, PLATFORM_FEE_RECIPIENT) ||
    hook.requiredHookFlags !== BigInt(REQUIRED_HOOK_FLAGS) ||
    hook.policyVersion !== 2n ||
    hook.policyChainId !== 1n ||
    !sameHex(hook.policyId, build.policy.id) ||
    !sameHex(hook.policyProfile, build.policy.profileId) ||
    !sameHex(hook.policyBasis, build.policy.basisId) ||
    !sameHex(hook.policyAssetMode, build.policy.assetModeId) ||
    hook.policyRatePpm !== BigInt(PLATFORM_FEE_RATE_PPM) ||
    hook.policyDenominatorPpm !== BigInt(PLATFORM_FEE_DENOMINATOR_PPM) ||
    !sameAddress(hook.policyRecipient, PLATFORM_FEE_RECIPIENT) ||
    hook.policyRequiredHookFlags !== BigInt(REQUIRED_HOOK_FLAGS) ||
    hook.poolBindingComplete !== true ||
    hook.poolInitialized !== true ||
    !exactPermissions(hook.permissions) ||
    !sameAddress(hook.customDeltaAccount, ZERO_ADDRESS) ||
    hook.maximumCustomDeltaAbsolute !== 0n ||
    (zeroProfile &&
      (!sameAddress(hook.customModule, ZERO_ADDRESS) ||
        hook.customModuleRuntimeCodeHash !== ZERO_BYTES32)) ||
    (!zeroProfile &&
      (sameAddress(hook.customModule, ZERO_ADDRESS) ||
        hook.customModuleRuntimeCodeHash === ZERO_BYTES32))
  ) fail();
}

function assertInitializer(
  initializer: InitializerState,
  entry: CanonicalTokenExploreEntry,
  vault: Address,
) {
  const stamp = entry.launchStampProvenance!;
  if (
    !sameAddress(initializer.graphDeployer, stamp.routeLauncherAddress) ||
    !sameAddress(initializer.poolManager, stamp.poolManagerAddress) ||
    !sameAddress(initializer.vault, vault) ||
    !sameAddress(initializer.hook, entry.hookAddress) ||
    !sameAddress(initializer.token, entry.tokenAddress) ||
    initializer.poolFee !== BigInt(stamp.poolKey.fee) ||
    initializer.tickSpacing !== BigInt(stamp.poolKey.tickSpacing) ||
    initializer.initialSqrtPriceX96 === 0n ||
    initializer.initialized !== true ||
    initializer.initializedTick < -(1n << 23n) ||
    initializer.initializedTick > (1n << 23n) - 1n ||
    !sameHex(initializer.initializedPoolId, entry.poolId) ||
    !sameHex(initializer.poolId, entry.poolId) ||
    !exactPoolKey(initializer.poolKey, entry)
  ) fail();
}

function componentByAddress(
  entry: CanonicalTokenExploreEntry,
  address: Address,
) {
  return entry.launchStampProvenance!.components.find(
    (component) => sameAddress(component.address, address),
  );
}

async function readForBuild(
  client: FeeReadClient,
  input: Readonly<{
    entry: CanonicalTokenExploreEntry;
    boundary: SnapshotBoundary;
    build: PlatformFeeProfileBuildV2;
    codeByAddress: ReadonlyMap<string, Hex>;
    stateView: Address;
    stateViewRuntimeCodeHash: Hex;
  }>,
): Promise<PlatformFeePolicyReadbackV2> {
  const { entry, build } = input;
  const stamp = entry.launchStampProvenance!;
  const blockNumber = BigInt(input.boundary.asOfBlock);
  if (
    !sameAddress(build.routeLauncher.address, stamp.routeLauncherAddress) ||
    !sameHex(
      build.routeLauncher.runtimeCodeHash,
      stamp.routeLauncherRuntimeCodeHash,
    )
  ) fail();

  const placeholderHook: HookState = Object.freeze({
    poolManager: LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
    graphDeployer: getAddress(ZERO_ADDRESS),
    vault: getAddress(ZERO_ADDRESS),
    accrualContextHash: ZERO_BYTES32,
    platformFeePpm: 0n,
    feeDenominatorPpm: 0n,
    platformFeeRecipient: getAddress(ZERO_ADDRESS),
    requiredHookFlags: 0n,
    policyVersion: 0n,
    policyChainId: 0n,
    policyId: ZERO_BYTES32,
    policyProfile: ZERO_BYTES32,
    policyBasis: ZERO_BYTES32,
    policyAssetMode: ZERO_BYTES32,
    policyRatePpm: 0n,
    policyDenominatorPpm: 0n,
    policyRecipient: getAddress(ZERO_ADDRESS),
    policyRequiredHookFlags: 0n,
    customModule: getAddress(ZERO_ADDRESS),
    customModuleRuntimeCodeHash: ZERO_BYTES32,
    customDeltaAccount: getAddress(ZERO_ADDRESS),
    maximumCustomDeltaAbsolute: 0n,
    poolBindingComplete: false,
    poolInitialized: false,
    authorizedInitializer: getAddress(ZERO_ADDRESS),
    authorizedInitializerRuntimeCodeHash: ZERO_BYTES32,
    boundPoolId: ZERO_BYTES32,
    boundInitialSqrtPriceX96: 0n,
    boundToken: getAddress(ZERO_ADDRESS),
    boundHookRuntimeCodeHash: ZERO_BYTES32,
    boundVaultRuntimeCodeHash: ZERO_BYTES32,
    boundTokenRuntimeCodeHash: ZERO_BYTES32,
    deploymentProfileHash: ZERO_BYTES32,
    compositionHash: ZERO_BYTES32,
    permissions: null,
  });
  const token = getAddress(entry.tokenAddress);
  const tokenComponent = componentByAddress(entry, token);
  const tokenCode = input.codeByAddress.get(token.toLowerCase());
  if (
    !tokenComponent ||
    tokenComponent.kind !== "token" ||
    tokenComponent.scope !== "exclusive" ||
    !tokenCode ||
    !sameHex(tokenCode, build.runtimeTemplates.token.normalizedRuntimeBytecode)
  ) fail();
  const otherComponents = stamp.components.filter(
    (component) => component.kind === "other" && component.scope === "exclusive",
  );
  const vaultMatches = otherComponents.filter((component) => {
    const code = input.codeByAddress.get(component.address.toLowerCase());
    if (!code) return false;
    const context = runtimeContext({
      entry,
      build,
      vault: getAddress(component.address),
      hookState: placeholderHook,
    });
    return exactRuntimeMatch(code, build.runtimeTemplates.vault, context);
  });
  if (vaultMatches.length !== 1) fail();
  const vault = getAddress(vaultMatches[0]!.address);
  const hook = getAddress(entry.hookAddress);
  const hookState = await readHookState(client, hook, blockNumber);
  assertHookPolicy(hookState, build, vault);
  const hookCode = input.codeByAddress.get(hook.toLowerCase());
  if (
    !hookCode ||
    !exactRuntimeMatch(
      hookCode,
      build.runtimeTemplates.hook,
      runtimeContext({ entry, build, vault, hookState }),
    )
  ) fail();
  const hookRuntimeCodeHash = keccak256(hookCode);
  if ((BigInt(hook) & ((1n << 14n) - 1n)) !== BigInt(REQUIRED_HOOK_FLAGS)) {
    fail();
  }

  const initializerMatches: Array<Readonly<{
    component: typeof otherComponents[number];
    state: InitializerState;
  }>> = [];
  for (const component of otherComponents) {
    if (sameAddress(component.address, vault)) continue;
    let state: InitializerState;
    try {
      state = await readInitializerState(
        client,
        getAddress(component.address),
        blockNumber,
      );
    } catch (error) {
      if (isOperationalRpcFailoverEligible(error)) throw error;
      continue;
    }
    const code = input.codeByAddress.get(component.address.toLowerCase());
    if (
      code &&
      exactRuntimeMatch(
        code,
        build.runtimeTemplates.initializer,
        runtimeContext({ entry, build, vault, hookState, initializer: state }),
      )
    ) {
      initializerMatches.push(Object.freeze({ component, state }));
    }
  }
  if (initializerMatches.length !== 1) fail();
  const initializerMatch = initializerMatches[0]!;
  const initializer = getAddress(initializerMatch.component.address);
  assertInitializer(initializerMatch.state, entry, vault);

  const vaultCode = input.codeByAddress.get(vault.toLowerCase());
  const initializerCode = input.codeByAddress.get(initializer.toLowerCase());
  if (!vaultCode || !initializerCode) fail();
  const vaultRuntimeCodeHash = keccak256(vaultCode);
  const initializerRuntimeCodeHash = keccak256(initializerCode);
  const tokenRuntimeCodeHash = keccak256(tokenCode);

  const moduleComponent =
    build.profile === "isolated-after-swap-zero-delta-opcode-safe"
      ? componentByAddress(entry, hookState.customModule)
      : undefined;
  const moduleCode = moduleComponent
    ? input.codeByAddress.get(moduleComponent.address.toLowerCase())
    : undefined;
  if (
    (build.profile === "isolated-after-swap-zero-delta-opcode-safe" &&
      (!moduleComponent ||
        moduleComponent.kind !== "other" ||
        moduleComponent.scope !== "exclusive" ||
        !moduleCode ||
        !customModuleRuntimeIsOpcodeSafe(moduleCode) ||
        !sameHex(
          moduleComponent.runtimeCodeHash,
          hookState.customModuleRuntimeCodeHash,
        ))) ||
    (build.profile === "zero-custom" && moduleComponent !== undefined)
  ) fail();

  const customModule =
    build.profile === "isolated-after-swap-zero-delta-opcode-safe"
      ? hookState.customModule
      : getAddress(ZERO_ADDRESS);
  const customModuleRuntimeCodeHash =
    build.profile === "isolated-after-swap-zero-delta-opcode-safe"
      ? hookState.customModuleRuntimeCodeHash
      : ZERO_BYTES32;
  const expectedDeploymentProfileHash =
    derivePlatformFeeDeploymentProfileHashV2(build, {
      hookRuntimeCodeHash,
      vaultRuntimeCodeHash,
      tokenRuntimeCodeHash,
      customModuleRuntimeCodeHash,
    });
  const expectedCompositionHash = derivePlatformFeeCompositionHashV2({
    deploymentProfileHash: expectedDeploymentProfileHash,
    hook,
    hookRuntimeCodeHash,
    vault,
    vaultRuntimeCodeHash,
    initializer,
    initializerRuntimeCodeHash,
    poolId: entry.poolId,
    initialSqrtPriceX96: initializerMatch.state.initialSqrtPriceX96,
    token,
    tokenRuntimeCodeHash,
    customModule,
    customModuleRuntimeCodeHash,
  });
  if (
    !sameAddress(hookState.authorizedInitializer, initializer) ||
    !sameHex(
      hookState.authorizedInitializerRuntimeCodeHash,
      initializerRuntimeCodeHash,
    ) ||
    !sameHex(hookState.boundPoolId, entry.poolId) ||
    hookState.boundInitialSqrtPriceX96 !==
      initializerMatch.state.initialSqrtPriceX96 ||
    !sameAddress(hookState.boundToken, token) ||
    !sameHex(hookState.boundHookRuntimeCodeHash, hookRuntimeCodeHash) ||
    !sameHex(hookState.boundVaultRuntimeCodeHash, vaultRuntimeCodeHash) ||
    !sameHex(hookState.boundTokenRuntimeCodeHash, tokenRuntimeCodeHash) ||
    !sameHex(
      hookState.deploymentProfileHash,
      expectedDeploymentProfileHash,
    ) ||
    !sameHex(hookState.compositionHash, expectedCompositionHash)
  ) fail();

  await readVaultSeal(client, {
    vault,
    hook,
    hookRuntimeCodeHash,
    currency0: getAddress(stamp.poolKey.currency0),
    currency1: getAddress(stamp.poolKey.currency1),
    blockNumber,
  });
  const slot0 = await client.readContract({
    address: input.stateView,
    abi: stateViewReadAbi,
    functionName: "getSlot0",
    args: [entry.poolId],
    blockNumber,
  });
  if (!Array.isArray(slot0) || bigintValue(slot0[0]) === 0n) fail();

  const runtimeContracts: Array<Readonly<{
    role: PlatformFeePolicyRuntimeRoleV2;
    address: Address;
    runtimeCodeHash: Hex;
  }>> = [
    {
      role: "router",
      address: getAddress(stamp.routerAddress),
      runtimeCodeHash: stamp.routerRuntimeCodeHash,
    },
    {
      role: "route-launcher",
      address: getAddress(stamp.routeLauncherAddress),
      runtimeCodeHash: stamp.routeLauncherRuntimeCodeHash,
    },
    {
      role: "pool-manager",
      address: getAddress(stamp.poolManagerAddress),
      runtimeCodeHash: LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH,
    },
    {
      role: "state-view",
      address: input.stateView,
      runtimeCodeHash: input.stateViewRuntimeCodeHash,
    },
    {
      role: "token",
      address: token,
      runtimeCodeHash: tokenRuntimeCodeHash,
    },
    { role: "hook", address: hook, runtimeCodeHash: hookRuntimeCodeHash },
    {
      role: "vault",
      address: vault,
      runtimeCodeHash: vaultRuntimeCodeHash,
    },
    {
      role: "initializer",
      address: initializer,
      runtimeCodeHash: initializerRuntimeCodeHash,
    },
  ];
  if (build.profile === "isolated-after-swap-zero-delta-opcode-safe") {
    runtimeContracts.push({
      role: "custom-module",
      address: hookState.customModule,
      runtimeCodeHash: hookState.customModuleRuntimeCodeHash,
    });
  }

  const result: PlatformFeePolicyReadbackV2 = Object.freeze({
    schemaVersion: "programmable.platform-fee-policy-readback.v2",
    status: "onchain-confirmed",
    chainId: "1",
    profileBuildId: build.profileBuildId,
    sourceBundleDigest: build.sourceBundleDigest,
    compilerArtifactDigest: build.compilerArtifactDigest,
    compilerSettingsHash: build.compilerSettingsHash,
    profile: build.profile,
    policyVersion: 2,
    policyId: build.policy.id,
    profileId: build.policy.profileId,
    basis: Object.freeze({
      id: build.policy.basisId,
      kind: "gross-unspecified-pool-currency-amount",
    }),
    assetMode: Object.freeze({
      id: build.policy.assetModeId,
      kind: "unspecified-pool-currency-per-swap",
    }),
    ratePpm: PLATFORM_FEE_RATE_PPM,
    denominatorPpm: PLATFORM_FEE_DENOMINATOR_PPM,
    recipient: PLATFORM_FEE_RECIPIENT,
    requiredHookFlags: REQUIRED_HOOK_FLAGS,
    poolId: entry.poolId,
    initialSqrtPriceX96: initializerMatch.state.initialSqrtPriceX96.toString(),
    initializer,
    deploymentProfileHash: expectedDeploymentProfileHash,
    compositionHash: expectedCompositionHash,
    customModule:
      build.profile === "isolated-after-swap-zero-delta-opcode-safe"
        ? hookState.customModule
        : null,
    customModuleRuntimeCodeHash:
      build.profile === "isolated-after-swap-zero-delta-opcode-safe"
        ? hookState.customModuleRuntimeCodeHash
        : null,
    customDeltaAccount: null,
    maximumCustomDeltaAbsolute:
      hookState.maximumCustomDeltaAbsolute.toString(),
    evidence: Object.freeze({
      source: "ethereum-mainnet-finalized-state",
      blockNumber: input.boundary.asOfBlock,
      blockHash: input.boundary.asOfBlockHash,
      finalityConfirmations: 64,
      contracts: Object.freeze(runtimeContracts.map(
        (contract) => Object.freeze(contract),
      )),
    }),
  });
  if (!isPlatformFeePolicyReadbackV2(result, {
    tokenAddress: entry.tokenAddress,
    hookAddress: entry.hookAddress,
    poolId: entry.poolId,
  })) fail();
  return result;
}

export async function readPlatformFeePolicyForRouterEntryV2(
  input: Readonly<{
    entry: CanonicalTokenExploreEntry;
    boundary: SnapshotBoundary;
    profileBuilds: readonly PlatformFeeProfileBuildV2[];
    stateView: Address;
    stateViewRuntimeCodeHash: Hex;
  }>,
  client: FeeReadClient,
): Promise<PlatformFeePolicyReadbackV2 | null> {
  if (input.profileBuilds.length === 0) return null;
  const stamp = input.entry.launchStampProvenance;
  if (
    input.entry.launchModel !== "custom-graph" ||
    !stamp ||
    stamp.kind !== "custom-graph" ||
    !isLaunchStampProvenanceV1(stamp, {
      tokenAddress: input.entry.tokenAddress,
      hookAddress: input.entry.hookAddress,
      poolId: input.entry.poolId,
    }) ||
    input.boundary.finalityConfirmations !== 64 ||
    !/^(?:0|[1-9][0-9]*)$/u.test(input.boundary.asOfBlock) ||
    BigInt(stamp.finalizedAtBlockNumber) > BigInt(input.boundary.asOfBlock)
  ) return null;

  const eligibleBuilds = input.profileBuilds.filter(
    (build) => sameAddress(
      build.routeLauncher.address,
      stamp.routeLauncherAddress,
    ) && sameHex(
      build.routeLauncher.runtimeCodeHash,
      stamp.routeLauncherRuntimeCodeHash,
    ),
  );
  if (eligibleBuilds.length === 0) return null;
  if (await client.getChainId() !== 1) fail();
  const blockNumber = BigInt(input.boundary.asOfBlock);
  const block = await client.getBlock({ blockNumber });
  if (!block.hash || !sameHex(block.hash, input.boundary.asOfBlockHash)) fail();

  await Promise.all([
    exactCode(
      client,
      getAddress(stamp.routerAddress),
      stamp.routerRuntimeCodeHash,
      blockNumber,
    ),
    exactCode(
      client,
      LAUNCH_STAMP_POOL_MANAGER_ADDRESS,
      LAUNCH_STAMP_POOL_MANAGER_RUNTIME_CODE_HASH,
      blockNumber,
    ),
    exactCode(
      client,
      input.stateView,
      input.stateViewRuntimeCodeHash,
      blockNumber,
    ),
    exactCode(
      client,
      getAddress(stamp.routeLauncherAddress),
      stamp.routeLauncherRuntimeCodeHash,
      blockNumber,
    ),
  ]);
  const codeByAddress = new Map<string, Hex>();
  await Promise.all(stamp.components.map(async (component) => {
    const address = getAddress(component.address);
    const code = await exactCode(
      client,
      address,
      component.runtimeCodeHash,
      blockNumber,
    );
    codeByAddress.set(address.toLowerCase(), code);
  }));

  const matches: PlatformFeePolicyReadbackV2[] = [];
  for (const build of eligibleBuilds) {
    try {
      matches.push(await readForBuild(client, {
        ...input,
        build,
        codeByAddress,
      }));
    } catch (error) {
      if (isOperationalRpcFailoverEligible(error)) throw error;
      // A profile build is only a candidate. Any deterministic mismatch or
      // getter/revert failure disqualifies that build without weakening the
      // durable Router identity. Provider failures still trigger RPC failover.
      continue;
    }
  }
  if (matches.length > 1) fail();
  return matches[0] ?? null;
}

function feePolicyClient(rpcUrl: string): FeeReadClient {
  return createPublicClient({
    chain: mainnet,
    batch: { multicall: true },
    transport: http(rpcUrl, { retryCount: 1, timeout: 8_000 }),
  });
}

export async function enrichRouterCustomSnapshotWithFeePolicyV2<
  Snapshot extends SnapshotBoundary & Readonly<{
    entries: readonly CanonicalTokenExploreEntry[];
  }>,
>(
  snapshot: Snapshot,
  dependencies: Readonly<{
    profileBuilds?: readonly PlatformFeeProfileBuildV2[];
    deployment?: OnchainDeployment;
    client?: FeeReadClient;
  }> = {},
): Promise<Snapshot> {
  let profileBuilds: readonly PlatformFeeProfileBuildV2[];
  try {
    profileBuilds = parsePlatformFeeProfileBuildsV2(
      dependencies.profileBuilds ?? PRODUCTION_PLATFORM_FEE_PROFILE_BUILDS_V2,
    );
  } catch (error) {
    console.warn("Router Custom platform fee build manifest invalid", {
      ...safeOperationalRpcError(error),
    });
    return snapshot;
  }
  if (profileBuilds.length === 0 || snapshot.entries.length === 0) {
    return snapshot;
  }
  const deployment = dependencies.deployment ??
    getWebsiteReadOnchainDeployment("production");
  if (deployment.chainId !== 1) return snapshot;

  const enrich = async (client: FeeReadClient) => {
    const entries = await Promise.all(snapshot.entries.map(async (entry) => {
      try {
        const platformFeePolicy = await readPlatformFeePolicyForRouterEntryV2({
          entry,
          boundary: snapshot,
          profileBuilds,
          stateView: deployment.stateView,
          stateViewRuntimeCodeHash: deployment.stateViewRuntimeCodeHash,
        }, client);
        return platformFeePolicy
          ? Object.freeze({ ...entry, platformFeePolicy })
          : entry;
      } catch (error) {
        if (isOperationalRpcFailoverEligible(error)) throw error;
        console.warn("Router Custom platform fee readback unconfirmed", {
          ...safeOperationalRpcError(error),
          launchId: entry.launchStampProvenance?.launchId,
        });
        return entry;
      }
    }));
    return Object.freeze({ ...snapshot, entries }) as Snapshot;
  };

  if (dependencies.client) {
    try {
      return await enrich(dependencies.client);
    } catch (error) {
      console.warn("Router Custom platform fee provider unavailable", {
        ...safeOperationalRpcError(error),
      });
      return snapshot;
    }
  }
  try {
    return await withOperationalRpcFailover(
      deployment,
      (selected) => enrich(feePolicyClient(selected.rpcUrl)),
    );
  } catch (error) {
    console.warn("Router Custom platform fee provider unavailable", {
      ...safeOperationalRpcError(error),
    });
    return snapshot;
  }
}
