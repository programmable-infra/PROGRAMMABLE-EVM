import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
} from "viem";

import canonicalSettlementFeeVaultArtifact from "./fixtures/programmable-settlement-fee-vault-v1.json" with { type: "json" };

import { statusLaunch, submitLaunch } from "../src/api-client.mjs";
import { loadTargetArtifact, validateStandardJsonInput } from "../src/build.mjs";
import {
  DIRECT_NATIVE_REQUIRED_SOLC_VERSION,
  GRAPH_FACTORY,
  MAX_STANDARD_JSON_SOURCES,
} from "../src/constants.mjs";
import { sha256Digest } from "../src/io.mjs";
import {
  buildDirectNativeProfileBinding,
  buildDirectNativeLaunchIntentHash,
  buildFundingAuthorization,
  buildFundingSignaturePatch,
  hashDirectNativeProfile,
  resolveDirectNativeProfile,
  validateEmbeddedDirectNativeProfile,
  validateDirectNativeProfileGraph,
  validateDirectNativePermitWindow,
  validateDirectNativeProfileSelection,
} from "../src/profile-direct-native-v1.mjs";
import {
  validateLaunchFile,
  validateLaunchRequest,
} from "../src/validate.mjs";
import { jsonResponse, validCapabilities } from "./fixtures/capabilities.mjs";

const SHA = `sha256:${"11".repeat(32)}`;
const RUNTIME_HASH = `0x${"22".repeat(32)}`;
const ROUTE_NAMESPACE = `0x${"33".repeat(32)}`;
const ROUTE_NONCE = `0x${"44".repeat(32)}`;
const LAUNCH_INTENT_HASH = `sha256:${"55".repeat(32)}`;
const TOKEN_ADDRESS = "0x0000000000000000000000000000000000001000";
const HOOK_ADDRESS = "0x00000000000000000000000000000000000020cc";
const INITIALIZER_ADDRESS = "0x0000000000000000000000000000000000003000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const INITIALIZER_ABI = [{
  type: "function",
  name: "initialize",
  stateMutability: "nonpayable",
  inputs: [
    { name: "r", type: "bytes32" },
    { name: "s", type: "bytes32" },
    { name: "v", type: "uint8" },
    { name: "configurationHash", type: "bytes32" },
  ],
  outputs: [],
}];

const SELECTION = {
  schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3",
  profileId: "programmable.direct-native-hook-graph.v1",
  profileRevision: 3,
  targetRoles: {
    tokenTargetId: "token",
    hookTargetId: "hook",
    initializerTargetId: "initializer",
    platformFeeBindingTargetId: "settlement-fee-vault",
  },
  fundingMode: "eip-3009-receive-with-authorization",
  accountingMode: "inclusive-selected-total",
  assessmentBase: "executed-gross-declared-quote",
  feeCurrency: "declared-quote-currency",
  claimMode: "claim-authority-selected-recipient",
  applicantSelectedBuyHundredthsOfBip: "0",
  applicantSelectedSellHundredthsOfBip: "30000",
};
const LEGACY_SELECTION = {
  ...SELECTION,
  schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v2",
  profileRevision: 2,
};

test("revision 3 publishes a 2,048-source Standard JSON ceiling without narrowing revision 2 retries", () => {
  const standardJson = (count) => ({
    language: "Solidity",
    sources: Object.fromEntries(Array.from(
      { length: count },
      (_, index) => [`Source${index}.sol`, { content: "contract C {}" }],
    )),
    settings: {},
  });
  assert.doesNotThrow(() => validateStandardJsonInput(
    standardJson(MAX_STANDARD_JSON_SOURCES),
    "rev3-boundary",
    { maximumSources: MAX_STANDARD_JSON_SOURCES },
  ));
  assert.throws(
    () => validateStandardJsonInput(
      standardJson(MAX_STANDARD_JSON_SOURCES + 1),
      "rev3-overflow",
      { maximumSources: MAX_STANDARD_JSON_SOURCES },
    ),
    /exceeds the 2048-source limit/u,
  );
  assert.doesNotThrow(() => validateStandardJsonInput(
    standardJson(MAX_STANDARD_JSON_SOURCES + 1),
    "legacy-retry",
  ));
});

test("revision 3 rejects an artifact from any other exact solc build before packaging", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-rev3-solc-"));
  try {
    await writeFile(path.join(root, "artifact.json"), JSON.stringify({
      metadata: JSON.stringify({
        compiler: { version: "0.8.25+commit.b61c2a91" },
        settings: { compilationTarget: { "Target.sol": "Target" } },
      }),
    }));
    const configured = {
      targetId: "target",
      compilationUnitId: "unit",
      artifact: "artifact.json",
      applicantSalt: ZERO_BYTES32,
      constructorArguments: [],
      initializer: null,
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "other",
      declaredHookPermissions: null,
      runtimeImmutables: [],
    };
    await assert.rejects(
      loadTargetArtifact(configured, 0, root, new Map([["unit", {
        standardJsonInput: {
          language: "Solidity",
          sources: { "Target.sol": { content: "contract Target {}" } },
          settings: {},
        },
      }]]), {
        apiVersion: "v2",
        requiredCompilerVersion: DIRECT_NATIVE_REQUIRED_SOLC_VERSION,
      }),
      /DIRECT_NATIVE_COMPILER_VERSION_UNSUPPORTED/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function unsignedInitializerCalldata() {
  return encodeFunctionData({
    abi: INITIALIZER_ABI,
    functionName: "initialize",
    args: [ZERO_BYTES32, ZERO_BYTES32, 0, ZERO_BYTES32],
  });
}

function graphBundle() {
  return {
    schemaVersion: "programmable.custom-graph-bundle.v1",
    sourceBundleSha256: SHA,
    targets: [
      target("token", "token", null),
      {
        ...target("hook", "hook", [
          "beforeInitialize",
          "beforeSwap",
          "afterSwap",
          "beforeSwapReturnDelta",
          "afterSwapReturnDelta",
        ]),
        constructorArguments: `0x${"00".repeat(32)}`,
        constructorAddressLocators: [{
          targetId: "settlement-fee-vault",
          byteOffset: 0,
          encoding: "abi-address-word",
        }],
      },
      { ...target("initializer", "other", null), initializerCalldata: unsignedInitializerCalldata() },
      {
        ...target("settlement-fee-vault", "other", null),
        creationBytecode: canonicalSettlementFeeVaultArtifact.creationBytecode,
        constructorArguments: encodeAbiParameters(
          parseAbiParameters("address"),
          [GRAPH_FACTORY],
        ),
        initializerCalldata: `0x8ce2a828${"00".repeat(32)}`,
        initializerAddressLocators: [{
          targetId: "hook",
          byteOffset: 4,
          encoding: "abi-address-word",
        }],
        expectedRuntimeCodeHash:
          canonicalSettlementFeeVaultArtifact.runtimeBytecodeKeccak256,
      },
    ],
    pool: { tokenTargetId: "token", hookTargetId: "hook", fee: 3000, tickSpacing: 60 },
  };
}

function target(targetId, componentKind, declaredHookPermissions) {
  return {
    targetId,
    applicantSalt: `0x${"00".repeat(32)}`,
    creationBytecode: "0x6000",
    constructorArguments: "0x",
    initializerCalldata: "0x",
    constructorAddressLocators: [],
    initializerAddressLocators: [],
    deploymentValueWei: "0",
    initializerValueWei: "0",
    expectedRuntimeCodeHash: RUNTIME_HASH,
    componentKind,
    declaredHookPermissions,
  };
}

function signaturePatch(bundle = graphBundle()) {
  return buildFundingSignaturePatch({
    targetId: "initializer",
    rOffsetBytes: 4,
    sOffsetBytes: 36,
    vOffsetBytes: 68,
  }, bundle, initializerArtifact());
}

function initializerArtifact(abi = INITIALIZER_ABI) {
  return {
    targetId: "initializer",
    abi,
    initializer: {
      function: "initialize",
      arguments: [ZERO_BYTES32, ZERO_BYTES32, 0, ZERO_BYTES32],
    },
  };
}

function bundleWithInitializer(calldata) {
  const bundle = graphBundle();
  bundle.targets = bundle.targets.map((target) => target.targetId === "initializer"
    ? { ...target, initializerCalldata: calldata }
    : target);
  return bundle;
}

test("V3 selection closes funding, accounting, claim, and applicant-selected rate modes", () => {
  assert.deepEqual(validateDirectNativeProfileSelection(SELECTION), {
    ...SELECTION,
    liquidityModel: {
      schemaVersion: "programmable.direct-native-liquidity-model-intent.v1",
      model: "external-concentrated-liquidity",
      declaredLaunchState: "liquidity_required",
    },
  });
  assert.equal(validateDirectNativeProfileSelection({
    ...SELECTION,
    applicantSelectedBuyHundredthsOfBip: "100000",
  }).applicantSelectedBuyHundredthsOfBip, "100000");
  assert.throws(
    () => validateDirectNativeProfileSelection({
      ...SELECTION,
      applicantSelectedBuyHundredthsOfBip: "100001",
    }),
    /between 0 and 100000/u,
  );
  assert.equal(validateDirectNativeProfileSelection({
    ...SELECTION,
    accountingMode: "additive-platform-share",
    applicantSelectedBuyHundredthsOfBip: "100000",
  }).applicantSelectedBuyHundredthsOfBip, "100000");
  assert.equal(validateDirectNativeProfileSelection({
    ...SELECTION,
    applicantSelectedSellHundredthsOfBip: "100000",
  }).applicantSelectedSellHundredthsOfBip, "100000");
  assert.throws(
    () => validateDirectNativeProfileSelection({
      ...SELECTION,
      applicantSelectedSellHundredthsOfBip: "100001",
    }),
    /between 0 and 100000/u,
  );
  assert.deepEqual(validateDirectNativeProfileSelection({
    ...SELECTION,
    fundingMode: "none",
    claimMode: "immutable-payout-recipient",
    payoutRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  }).payoutRecipient, "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
  assert.throws(
    () => validateDirectNativeProfileSelection({
      ...SELECTION,
      claimMode: "immutable-payout-recipient",
      payoutRecipient: TOKEN_ADDRESS,
    }),
    /platform claim authority/u,
  );
  assert.throws(
    () => validateDirectNativeProfileSelection({
      ...SELECTION,
      feeCurrency: "input-currency",
    }),
    /not a supported closed pair/u,
  );
  assert.deepEqual(validateDirectNativePermitWindow({
    validAfter: "900",
    deadline: "1200",
  }), { validAfter: "900", deadline: "1200" });
  assert.deepEqual(validateDirectNativePermitWindow({
    validAfter: "900",
    deadline: "87300",
  }), { validAfter: "900", deadline: "87300" });
  assert.throws(
    () => validateDirectNativePermitWindow({ validAfter: "900", deadline: "87301" }),
    /must not exceed 86400 seconds/u,
  );
});

test("live V3.3 profile binds static admission without claiming safety or fee behavior", () => {
  const profile = resolveDirectNativeProfile(SELECTION);
  assert.equal(profile.profileVersion, "3.3.0");
  assert.deepEqual(profile.projectMetadataPolicy, {
    schemaVersion: "programmable.project-metadata-policy.v1",
    descriptionMinimumUtf8Bytes: 20,
    descriptionMaximumUtf8Bytes: 4096,
    descriptionMinimumUnicodeLettersOrNumbers: 8,
    imageRequired: true,
    imageReceiptSourceManifestBindingRequired: true,
    imageMediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    linksMaximumCount: 32,
    requiredLinkKinds: ["website", "x"],
    exactlyOneRequiredLinkPerKind: true,
    websiteUriPolicy: "canonical-public-credential-free-https",
    xUriPattern: "^https://x\\.com/[A-Za-z0-9_]{1,64}$",
  });
  assert.deepEqual(profile.platformFeePolicy, {
    schemaVersion: "programmable.platform-fee-policy.v1",
    accountingMode: "inclusive-selected-total",
    applicability: "successful-pool-swaps",
    rateDenominator: "1000000",
    programmableFeeHundredthsOfBip: "1000",
    assessmentBase: "executed-gross-declared-quote",
    feeCurrency: "declared-quote-currency",
    roundingMode: "floor",
    claimAuthority: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  });
  assert.deepEqual(profile.platformAdmissionPolicy, {
    schemaVersion: "programmable.direct-native-platform-admission-policy.v1",
    mode: "deterministic-exact-source-graph-static-baseline-v1",
    receiptSchemaVersion: "programmable.platform-admission-receipt.v1",
    engineId: "programmable.direct-native-static-admission",
    engineVersion: "1.0.0",
    exactSourceCompilerGraphBindingRequired: true,
    staticBaselineGateVersion: "1.0.0",
    blockingFindingRules: [
      { code: "RUNTIME_CALLCODE", targetRoles: ["any"] },
      { code: "RUNTIME_SELFDESTRUCT", targetRoles: ["any"] },
      { code: "SOURCE_SELFDESTRUCT_SURFACE", targetRoles: ["any"] },
      { code: "V4_CALLBACK_AUTHENTICATION_MISSING", targetRoles: ["hook"] },
      { code: "V4_CALLBACK_AUTHENTICATION_INVALID", targetRoles: ["hook"] },
      { code: "V4_CALLBACK_POOL_MANAGER_MISMATCH", targetRoles: ["hook"] },
      { code: "V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING", targetRoles: ["hook"] },
    ],
    warningDisposition: "bound-and-visible",
    noBlockingFindingDisposition: "router-simulation-eligible",
    blockingFindingDisposition: "action-required",
    routerSimulationRequiredBeforeAuthorization: true,
    receiptAuthority: "platform-only",
    assurance: "launch-admission-only",
    safetyClaim: false,
    feeBehaviorClaim: false,
  });
  assert.equal(Object.hasOwn(profile, "platformFeeProofPolicy"), false);
  assert.equal(profile.productionLaunchAuthorized, true);
  assert.deepEqual(profile.graphPolicy, {
    minimumTargets: 3,
    maximumTargets: 16,
    directTargetsOnly: true,
  });
  assert.equal(profile.permitAuthority, "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b");
  assert.equal(
    profile.permitAuthorityRuntimeCodeHash,
    "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  );
  assert.match(hashDirectNativeProfile(profile), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(profile).includes("ProgrammableVolumeFeeHookV2"), false);
  assert.equal(Object.hasOwn(profile, "feeEnforcement"), false);
  const additive = resolveDirectNativeProfile({
    ...SELECTION,
    accountingMode: "additive-platform-share",
  });
  assert.equal(additive.platformFeePolicy.accountingMode, "additive-platform-share");
});

test("default V3.3 and explicit V3.4 preserve exact embedded-profile validation for retries", () => {
  const current = resolveDirectNativeProfile(SELECTION);
  const preparatory = resolveDirectNativeProfile(SELECTION, { profileVersion: "3.4.0" });
  const completeMetadataLegacy = resolveDirectNativeProfile(SELECTION, {
    profileVersion: "3.3.0",
  });
  const legacyMetadata = resolveDirectNativeProfile(SELECTION, { profileVersion: "3.2.0" });
  const preMetadata = resolveDirectNativeProfile(SELECTION, { profileVersion: "3.1.0" });
  const legacy = resolveDirectNativeProfile(SELECTION, { profileVersion: "3.0.0" });

  assert.equal(current.profileVersion, "3.3.0");
  assert.equal(preparatory.profileVersion, "3.4.0");
  assert.equal(completeMetadataLegacy.profileVersion, "3.3.0");
  assert.equal(legacyMetadata.profileVersion, "3.2.0");
  assert.equal(preMetadata.profileVersion, "3.1.0");
  assert.equal(legacy.profileVersion, "3.0.0");
  assert.deepEqual(validateEmbeddedDirectNativeProfile(current), current);
  assert.deepEqual(validateEmbeddedDirectNativeProfile(preparatory), preparatory);
  assert.deepEqual(
    validateEmbeddedDirectNativeProfile(completeMetadataLegacy),
    completeMetadataLegacy,
  );
  assert.deepEqual(validateEmbeddedDirectNativeProfile(legacyMetadata), legacyMetadata);
  assert.deepEqual(validateEmbeddedDirectNativeProfile(preMetadata), preMetadata);
  assert.deepEqual(validateEmbeddedDirectNativeProfile(legacy), legacy);
  assert.deepEqual(preMetadata.platformAdmissionPolicy, current.platformAdmissionPolicy);
  assert.deepEqual(completeMetadataLegacy.projectMetadataPolicy, current.projectMetadataPolicy);
  assert.equal(Object.hasOwn(legacyMetadata, "projectMetadataPolicy"), false);
  assert.deepEqual(
    legacy.platformAdmissionPolicy.blockingFindingRules.map(({ code }) => code),
    [
      "SOURCE_TARGET_ANALYSIS_INCOMPLETE",
      "V4_CALLBACK_AUTHENTICATION_REVIEW_REQUIRED",
      "V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING",
      "SOURCE_MUTABLE_BLOCKLIST_SURFACE",
      "SOURCE_MUTABLE_TRANSFER_RESTRICTION",
      "SOURCE_PUBLIC_MINT_SURFACE",
      "SOURCE_MUTABLE_PAUSE_SURFACE",
      "SOURCE_MUTABLE_TAX_OR_FEE_SURFACE",
      "SOURCE_PROXY_OR_UPGRADE_SURFACE",
      "SOURCE_SELFDESTRUCT_SURFACE",
      "RUNTIME_CALLCODE",
      "RUNTIME_DELEGATECALL",
      "RUNTIME_SELFDESTRUCT",
    ],
  );
  assert.throws(
    () => validateEmbeddedDirectNativeProfile({
      ...legacy,
      platformAdmissionPolicy: current.platformAdmissionPolicy,
    }),
    /closed embedded launchProfile/u,
  );
  assert.deepEqual(
    resolveDirectNativeProfile(SELECTION, { profileVersion: "3.4.0" }),
    preparatory,
  );
});

test("V3 keeps revision 2 profile and hash semantics available for exact retries", () => {
  const legacy = resolveDirectNativeProfile(LEGACY_SELECTION);
  assert.equal(legacy.schemaVersion, "programmable.direct-native-hook-graph-profile.v2");
  assert.equal(legacy.profileRevision, 2);
  assert.equal(legacy.profileVersion, "2.0.0");
  assert.equal(Object.hasOwn(legacy, "platformAdmissionPolicy"), false);
  assert.equal(
    legacy.platformFeeProofPolicy.schemaVersion,
    "programmable.platform-fee-conformance-policy.v1",
  );
  assert.match(hashDirectNativeProfile(legacy), /^sha256:[0-9a-f]{64}$/u);
});

test("funding signature patch derives only from aligned, distinct, zero initializer words", () => {
  const patch = signaturePatch();
  assert.deepEqual(patch, {
    schemaVersion: "programmable.eip3009-signature-patch.v1",
    targetId: "initializer",
    unsignedInitializerCalldataSha256: patch.unsignedInitializerCalldataSha256,
    initializerCalldataLengthBytes: 132,
    signatureEncoding: "eip3009-r-s-v-abi-words",
    rOffsetBytes: 4,
    sOffsetBytes: 36,
    vOffsetBytes: 68,
  });
  assert.match(patch.unsignedInitializerCalldataSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.throws(
    () => buildFundingSignaturePatch({
      targetId: "initializer",
      rOffsetBytes: 5,
      sOffsetBytes: 36,
      vOffsetBytes: 68,
    }, graphBundle(), initializerArtifact()),
    /ABI word/u,
  );
  assert.throws(
    () => buildFundingSignaturePatch({
      targetId: "initializer",
      rOffsetBytes: 4,
      sOffsetBytes: 4,
      vOffsetBytes: 68,
    }, graphBundle(), initializerArtifact()),
    /must be distinct/u,
  );
});

test("funding signature patch proves exact top-level ABI types and canonical full calldata", () => {
  const valid = unsignedInitializerCalldata();
  const attempt = (calldata, abi, offsets = {
    rOffsetBytes: 4,
    sOffsetBytes: 36,
    vOffsetBytes: 68,
  }) => buildFundingSignaturePatch({
    targetId: "initializer",
    ...offsets,
  }, bundleWithInitializer(calldata), initializerArtifact(abi));

  assert.throws(
    () => attempt(`0xdeadbeef${valid.slice(10)}`, INITIALIZER_ABI),
    /selector|artifact ABI/u,
  );

  const addressAbi = [{
    ...INITIALIZER_ABI[0],
    inputs: [
      { name: "r", type: "address" },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint8" },
    ],
  }];
  const addressCalldata = encodeFunctionData({
    abi: addressAbi,
    functionName: "initialize",
    args: [ZERO_ADDRESS, ZERO_BYTES32, 0],
  });
  assert.throws(
    () => attempt(addressCalldata, addressAbi),
    /top-level bytes32/u,
  );

  const uintVAbi = [{
    ...INITIALIZER_ABI[0],
    inputs: [
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint256" },
    ],
  }];
  const uintVCalldata = encodeFunctionData({
    abi: uintVAbi,
    functionName: "initialize",
    args: [ZERO_BYTES32, ZERO_BYTES32, 0n],
  });
  assert.throws(
    () => attempt(uintVCalldata, uintVAbi),
    /top-level uint8/u,
  );

  const dynamicAbi = [{
    ...INITIALIZER_ABI[0],
    inputs: [
      { name: "payload", type: "bytes" },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint8" },
    ],
  }];
  const dynamicCalldata = encodeFunctionData({
    abi: dynamicAbi,
    functionName: "initialize",
    args: [`0x${"00".repeat(32)}`, ZERO_BYTES32, 0],
  });
  assert.throws(
    () => attempt(dynamicCalldata, dynamicAbi, {
      rOffsetBytes: 132,
      sOffsetBytes: 36,
      vOffsetBytes: 68,
    }),
    /top-level bytes32/u,
  );

  const tupleAbi = [{
    ...INITIALIZER_ABI[0],
    inputs: [
      {
        name: "signature",
        type: "tuple",
        components: [
          { name: "r", type: "bytes32" },
          { name: "padding", type: "bytes32" },
        ],
      },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint8" },
    ],
  }];
  const tupleCalldata = encodeFunctionData({
    abi: tupleAbi,
    functionName: "initialize",
    args: [{ r: ZERO_BYTES32, padding: ZERO_BYTES32 }, ZERO_BYTES32, 0],
  });
  assert.throws(
    () => attempt(tupleCalldata, tupleAbi),
    /top-level bytes32/u,
  );

  const staticPrefixAbi = [{
    ...INITIALIZER_ABI[0],
    inputs: [
      { name: "prefix", type: "uint256[2]" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint8" },
    ],
  }];
  const staticPrefixCalldata = encodeFunctionData({
    abi: staticPrefixAbi,
    functionName: "initialize",
    args: [[0n, 0n], ZERO_BYTES32, ZERO_BYTES32, 0],
  });
  const staticPrefixPatch = attempt(staticPrefixCalldata, staticPrefixAbi, {
    rOffsetBytes: 68,
    sOffsetBytes: 100,
    vOffsetBytes: 132,
  });
  assert.deepEqual(
    [
      staticPrefixPatch.rOffsetBytes,
      staticPrefixPatch.sOffsetBytes,
      staticPrefixPatch.vOffsetBytes,
    ],
    [68, 100, 132],
  );

  assert.throws(
    () => attempt(valid, [...INITIALIZER_ABI, { ...INITIALIZER_ABI[0] }]),
    /exactly one artifact ABI entry/u,
  );
  assert.throws(
    () => attempt(`${valid}${"00".repeat(32)}`, INITIALIZER_ABI),
    /artifact ABI|canonical full ABI encoding/u,
  );
});

test("V3 binding accepts applicant hook mask and discloses inclusive economics and claim mode", () => {
  const bundle = graphBundle();
  const binding = buildDirectNativeProfileBinding(SELECTION, {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: HOOK_ADDRESS },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
    fundingSignaturePatch: signaturePatch(bundle),
  });
  assert.equal(binding.hookPermissionMask, 0x20cc);
  assert.deepEqual(binding.platformFeeBinding.economics.buy, {
    applicantSelectedHundredthsOfBip: "0",
    projectHundredthsOfBip: "0",
    effectiveTotalHundredthsOfBip: "1000",
  });
  assert.deepEqual(binding.platformFeeBinding.economics.sell, {
    applicantSelectedHundredthsOfBip: "30000",
    projectHundredthsOfBip: "29000",
    effectiveTotalHundredthsOfBip: "30000",
  });
  assert.deepEqual(binding.platformFeeBinding.claimBinding, {
    mode: "claim-authority-selected-recipient",
    claimAuthority: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    destinationConstraint: "nonzero-address",
  });
  assert.match(binding.expectedPoolId, /^0x[0-9a-f]{64}$/u);
  validateDirectNativeProfileGraph(
    resolveDirectNativeProfile(SELECTION),
    binding,
    bundle,
  );
  const invalidFeeBundle = graphBundle();
  invalidFeeBundle.pool.fee = 1_000_001;
  assert.throws(
    () => validateDirectNativeProfileGraph(
      resolveDirectNativeProfile(SELECTION),
      binding,
      invalidFeeBundle,
    ),
    /pool fee must be between 0 and 999999 or the dynamic-fee sentinel/u,
  );
});

test("V3 binds each declared liquidity model without claiming it already passed assessment", () => {
  const bundle = graphBundle();
  const context = {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: HOOK_ADDRESS },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
    fundingSignaturePatch: signaturePatch(bundle),
  };
  const inventorySelection = {
    ...SELECTION,
    liquidityModel: {
      schemaVersion: "programmable.direct-native-liquidity-model-intent.v1",
      model: "hook-inventory-custom-accounting",
      declaredLaunchState: "assessment_required",
      inventoryTargetId: "hook",
      assessment: {
        schemaVersion: "programmable.direct-native-liquidity-model-assessment.v1",
        status: "required",
        requestClaimsExecution: false,
        requiredVectorIds: [
          "liquidity.hook-inventory.buy-settlement",
          "liquidity.hook-inventory.sell-settlement",
          "liquidity.hook-inventory.delta-solvency",
          "liquidity.hook-inventory.backing-and-withdrawal",
        ],
      },
    },
  };
  const inventoryBinding = buildDirectNativeProfileBinding(inventorySelection, context);
  assert.equal(inventoryBinding.liquidityModel.model, "hook-inventory-custom-accounting");
  validateDirectNativeProfileGraph(
    resolveDirectNativeProfile(inventorySelection),
    inventoryBinding,
    bundle,
  );

  const seededSelection = {
    ...SELECTION,
    liquidityModel: {
      schemaVersion: "programmable.direct-native-liquidity-model-intent.v1",
      model: "launch-seeded-concentrated-liquidity",
      declaredLaunchState: "assessment_required",
      liquidityTargetId: "initializer",
      assessment: {
        schemaVersion: "programmable.direct-native-liquidity-model-assessment.v1",
        status: "required",
        requestClaimsExecution: false,
        requiredVectorIds: [
          "liquidity.seeded.pool-active-liquidity",
          "liquidity.seeded.position-custody-and-withdrawal",
          "liquidity.seeded.buy-and-sell",
        ],
      },
    },
  };
  const seededBinding = buildDirectNativeProfileBinding(seededSelection, context);
  assert.equal(seededBinding.liquidityModel.liquidityTargetId, "initializer");
  validateDirectNativeProfileGraph(
    resolveDirectNativeProfile(seededSelection),
    seededBinding,
    bundle,
  );

  assert.throws(
    () => validateDirectNativeProfileSelection({
      ...inventorySelection,
      liquidityModel: {
        ...inventorySelection.liquidityModel,
        assessment: {
          ...inventorySelection.liquidityModel.assessment,
          status: "passed",
        },
      },
    }),
    /without claiming execution/u,
  );
});

test("V3 accepts the zero hook-permission mask only for the dynamic-fee sentinel", () => {
  const bundle = graphBundle();
  bundle.pool.fee = 0x800000;
  bundle.targets = bundle.targets.map((candidate) => candidate.targetId === "hook"
    ? { ...candidate, declaredHookPermissions: [] }
    : candidate);
  const selection = {
    ...SELECTION,
    fundingMode: "none",
  };
  const binding = buildDirectNativeProfileBinding(selection, {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: "0x0000000000000000000000000000000000004000" },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
  });
  assert.equal(binding.hookPermissionMask, 0);
  validateDirectNativeProfileGraph(resolveDirectNativeProfile(selection), binding, bundle);

  const staticFeeBundle = structuredClone(bundle);
  staticFeeBundle.pool.fee = 3_000;
  assert.throws(
    () => validateDirectNativeProfileGraph(
      resolveDirectNativeProfile(selection),
      binding,
      staticFeeBundle,
    ),
    /zero-permission hooks require the dynamic-fee sentinel/u,
  );
});

test("V3 accepts a variable valid hook mask and a zero-value no-funding graph", () => {
  const bundle = graphBundle();
  bundle.targets = bundle.targets.map((candidate) => candidate.targetId === "hook"
    ? { ...candidate, declaredHookPermissions: ["beforeSwap"] }
    : candidate);
  const selection = {
    ...SELECTION,
    fundingMode: "none",
    accountingMode: "inclusive-selected-total",
    claimMode: "immutable-payout-recipient",
    payoutRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    applicantSelectedBuyHundredthsOfBip: "10000",
    applicantSelectedSellHundredthsOfBip: "10000",
  };
  const binding = buildDirectNativeProfileBinding(selection, {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: "0x0000000000000000000000000000000000001080" },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
  });
  assert.equal(binding.hookPermissionMask, 0x80);
  assert.equal(Object.hasOwn(binding, "fundingSignaturePatch"), false);
  assert.deepEqual(binding.platformFeeBinding.claimBinding, {
    mode: "immutable-payout-recipient",
    claimAuthority: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    payoutRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  });
  validateDirectNativeProfileGraph(resolveDirectNativeProfile(selection), binding, bundle);
  const funded = structuredClone(bundle);
  funded.targets[0].deploymentValueWei = "1";
  assert.throws(
    () => validateDirectNativeProfileGraph(resolveDirectNativeProfile(selection), binding, funded),
    /fundingMode none requires zero deployment and initializer value/u,
  );
});

test("V3 binds native launch value to the separately reviewed Router transaction", () => {
  const bundle = graphBundle();
  bundle.targets[2].initializerValueWei = "100000000000000000";
  const selection = {
    ...SELECTION,
    fundingMode: "wallet-transaction-value",
  };
  const binding = buildDirectNativeProfileBinding(selection, {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: HOOK_ADDRESS },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
  });
  assert.deepEqual(resolveDirectNativeProfile(selection).fundingPolicy, {
    mode: "wallet-transaction-value",
    launchFundingRequired: true,
    signatureRequired: false,
    valueSource: "exact-router-transaction-msg-value",
  });
  assert.equal(Object.hasOwn(binding, "fundingSignaturePatch"), false);
  validateDirectNativeProfileGraph(resolveDirectNativeProfile(selection), binding, bundle);

  const zeroValueBundle = graphBundle();
  const zeroValueBinding = buildDirectNativeProfileBinding(selection, {
    graphBundle: zeroValueBundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: HOOK_ADDRESS },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
  });
  assert.throws(
    () => validateDirectNativeProfileGraph(
      resolveDirectNativeProfile(selection),
      zeroValueBinding,
      zeroValueBundle,
    ),
    /wallet-transaction-value requires a nonzero exact Router transaction value/u,
  );
});

test("V3 EIP-3009 funding excludes native Router transaction value", () => {
  const bundle = graphBundle();
  const binding = buildDirectNativeProfileBinding(SELECTION, {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: HOOK_ADDRESS },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
    fundingSignaturePatch: signaturePatch(bundle),
  });
  const nativeValueBundle = structuredClone(bundle);
  nativeValueBundle.targets[2].initializerValueWei = "1";
  assert.throws(
    () => validateDirectNativeProfileGraph(
      resolveDirectNativeProfile(SELECTION),
      binding,
      nativeValueBundle,
    ),
    /EIP-3009 funding requires zero native deployment and initializer value/u,
  );
});

test("V3 additive accounting preserves the applicant project rate and adds exactly 1000 ppm", () => {
  const bundle = graphBundle();
  const selection = {
    ...SELECTION,
    accountingMode: "additive-platform-share",
    applicantSelectedBuyHundredthsOfBip: "29000",
    applicantSelectedSellHundredthsOfBip: "29000",
  };
  const binding = buildDirectNativeProfileBinding(selection, {
    graphBundle: bundle,
    predictions: [
      { targetId: "token", predictedAddress: TOKEN_ADDRESS },
      { targetId: "hook", predictedAddress: HOOK_ADDRESS },
      { targetId: "initializer", predictedAddress: INITIALIZER_ADDRESS },
    ],
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    quoteCurrency: ZERO_ADDRESS,
    fundingSignaturePatch: signaturePatch(bundle),
  });
  assert.deepEqual(binding.platformFeeBinding.economics.buy, {
    applicantSelectedHundredthsOfBip: "29000",
    projectHundredthsOfBip: "29000",
    effectiveTotalHundredthsOfBip: "30000",
  });
});

test("EIP-3009 intent is pre-signature, launch-intent-bound, and uses a separately derived nonce", () => {
  const context = {
    launchWallet: "0x0000000000000000000000000000000000004000",
    predictedInitializer: INITIALIZER_ADDRESS,
    routeNamespace: ROUTE_NAMESPACE,
    routeNonce: ROUTE_NONCE,
    launchIntentHash: LAUNCH_INTENT_HASH,
    nowSeconds: 1_000,
  };
  const first = buildFundingAuthorization({
    schemaVersion: "programmable.funding-authorization-input.v1",
    method: "eip-3009-receive-with-authorization",
    value: "30000000",
    validAfter: "900",
    validBefore: "1200",
  }, context);
  assert.match(first.fundingIntentHash, /^0x[0-9a-f]{64}$/u);
  assert.match(first.fundingAuthorization.nonce, /^0x[0-9a-f]{64}$/u);
  assert.notEqual(first.fundingAuthorization.nonce, first.fundingIntentHash);
  assert.equal(Object.hasOwn(first.fundingAuthorization, "signature"), false);
  const changed = buildFundingAuthorization({
    schemaVersion: "programmable.funding-authorization-input.v1",
    method: "eip-3009-receive-with-authorization",
    value: "30000000",
    validAfter: "900",
    validBefore: "1200",
  }, { ...context, launchIntentHash: `sha256:${"66".repeat(32)}` });
  assert.notEqual(changed.fundingIntentHash, first.fundingIntentHash);
  assert.notEqual(changed.fundingAuthorization.nonce, first.fundingAuthorization.nonce);
});

test("V3 launch and funding intents preserve rev2 and separate rev3 hash domains", () => {
  const repeated = (character) => character.repeat(64);
  const fundingSignaturePatch = {
    schemaVersion: "programmable.eip3009-signature-patch.v1",
    targetId: "initializer",
    unsignedInitializerCalldataSha256: `sha256:${repeated("3")}`,
    initializerCalldataLengthBytes: 100,
    signatureEncoding: "eip3009-r-s-v-abi-words",
    rOffsetBytes: 4,
    sOffsetBytes: 36,
    vOffsetBytes: 68,
  };
  const launchIntent = {
    schemaVersion: "programmable.custom-launch-create-request.v3",
    launchWallet: "0x0000000000000000000000000000000000004000",
    chainId: "1",
    nonce: `0x${repeated("2")}`,
    sourceDescriptor: { a: "x" },
    sourceBundleManifest: { b: "y" },
    graphBundleHash: `sha256:${repeated("4")}`,
    verificationBundleHash: `sha256:${repeated("5")}`,
    launchProfileHash: `sha256:${repeated("6")}`,
    permitWindow: { validAfter: "900", deadline: "1200" },
    launchProfileSelection: {
      schemaVersion: "programmable.direct-native-hook-graph-profile-selection-binding.v2",
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 2,
      routeNamespace: `0x${repeated("1")}`,
      routeNonce: `0x${repeated("2")}`,
      fundingSignaturePatch,
    },
  };
  const launchIntentHash = buildDirectNativeLaunchIntentHash(launchIntent);
  assert.equal(
    launchIntentHash,
    "sha256:ac825d38629a4658163fe0df38215eb7604bfb469b3100d8d5be84cd236e0786",
  );
  const rev3LaunchIntentHash = buildDirectNativeLaunchIntentHash({
    ...launchIntent,
    launchProfileSelection: {
      ...launchIntent.launchProfileSelection,
      schemaVersion: "programmable.direct-native-hook-graph-profile-selection-binding.v3",
      profileRevision: 3,
    },
  });
  assert.equal(
    rev3LaunchIntentHash,
    "sha256:6e137eb82ea6ef4e6abcb26e293fec761e8ad0dd3a44d0e7c4a4df5de7342e85",
  );
  assert.notEqual(rev3LaunchIntentHash, launchIntentHash);

  const context = {
    launchWallet: "0x0000000000000000000000000000000000004000",
    predictedInitializer: "0x0000000000000000000000000000000000005000",
    routeNamespace: `0x${repeated("1")}`,
    routeNonce: `0x${repeated("2")}`,
    launchIntentHash,
    nowSeconds: 1_000,
  };
  const input = {
    schemaVersion: "programmable.funding-authorization-input.v1",
    method: "eip-3009-receive-with-authorization",
    value: "30000000",
    validAfter: "900",
    validBefore: "1200",
  };
  const funding = buildFundingAuthorization(input, context);
  assert.equal(
    funding.fundingIntentHash,
    "0xaf182039cf2b46a9105af333262ff0dcb36104d5fe05f3148021a75e75468549",
  );
  assert.equal(
    funding.fundingAuthorization.nonce,
    "0xd518e54ff8850ac64c6f2ef191e91b19c0785fcc80f5d10eb071075cc1dfa18b",
  );

  const excludedFinalState = buildFundingAuthorization(input, {
    ...context,
    signature: `0x${"77".repeat(65)}`,
    initializerCalldataHash: `0x${repeated("8")}`,
    graphCommitment: `0x${repeated("9")}`,
    permitDigest: `0x${repeated("a")}`,
  });
  assert.deepEqual(excludedFinalState, funding);
});

test("V3 request-only validation fails closed without exact config and artifact ABI", async () => {
  const request = {
    schemaVersion: "programmable.custom-launch-create-request.v3",
  };
  assert.throws(
    () => validateLaunchRequest(request),
    /V3_ARTIFACT_CONFIG_REQUIRED/u,
  );

  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-v3-validate-"));
  const launchPath = path.join(root, "launch.json");
  await writeFile(launchPath, `${JSON.stringify(request)}\n`, "utf8");
  await assert.rejects(
    validateLaunchFile({ launchPath }),
    /V3_ARTIFACT_CONFIG_REQUIRED/u,
  );
});

test("V3 submit and status select the V3 route and stop at the funding wallet action", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-direct-native-v3-"));
  const launchPath = path.join(root, "launch.json");
  const requestBytes = Buffer.from(
    '{"schemaVersion":"programmable.custom-launch-create-request.v3"}\n',
    "utf8",
  );
  await writeFile(launchPath, requestBytes);
  const urls = [];
  const requestId = "60000000-0000-4000-8000-000000000006";
  const submit = await submitLaunch({
    launchPath,
    configPath: path.join(root, "programmable-launch.config.json"),
    idempotencyKey: "direct-native-v3-route-0001",
    apiOrigin: "https://api.programmable.market",
    stateDirectory: path.join(root, "state"),
    maxAttempts: 1,
    validateLaunchFileImpl: async () => ({
      schemaVersion: "programmable.custom-launch-create-request.v3",
      requestSha256: sha256Digest(requestBytes),
    }),
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.endsWith("/v3/capabilities")) {
        return jsonResponse(validCapabilities());
      }
      return new Response(JSON.stringify({
        schemaVersion: "programmable.custom-launch.v3",
        requestId,
        launchId: requestId,
        status: "awaiting_funding_authorization",
      }), { status: 202, headers: { "content-type": "application/json" } });
    },
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });
  assert.deepEqual(urls.slice(0, 2), [
    "https://api.programmable.market/v3/capabilities",
    "https://api.programmable.market/v3/custom-launches",
  ]);
  const journal = JSON.parse(await readFile(submit.journalPath, "utf8"));
  assert.equal(journal.requestPath, "/v3/custom-launches");
  assert.ok(!JSON.stringify(journal).includes("pm_live_publictest_secretvalue"));

  const status = await statusLaunch({
    requestId,
    apiVersion: 3,
    watch: true,
    until: "authorized",
    apiOrigin: "https://api.programmable.market",
    maxAttempts: 1,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({
        schemaVersion: "programmable.custom-launch.v3",
        requestId,
        launchId: requestId,
        status: "awaiting_funding_authorization",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });
  assert.equal(
    urls[2],
    `https://api.programmable.market/v3/custom-launches/${requestId}`,
  );
  assert.equal(status.stopped, true);
  assert.equal(status.walletHandoffReady, true);
  assert.equal(status.walletHandoffStage, "funding-signature-required");
});
