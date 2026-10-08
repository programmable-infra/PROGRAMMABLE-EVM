#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "../src/canonical-json.mjs";
import { PACKAGE_VERSION } from "../src/constants.mjs";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const documentPaths = Object.freeze({
  "custom-launch-v1.json": path.join(repositoryRoot, "public/openapi/custom-launch-v1.json"),
  "custom-launch-v2.json": path.join(repositoryRoot, "public/openapi/custom-launch-v2.json"),
  "custom-launch-v3.json": path.join(repositoryRoot, "public/openapi/custom-launch-v3.json"),
  "custom-launch-v4.json": path.join(repositoryRoot, "public/openapi/custom-launch-v4.json"),
});
const HTTP_METHODS = Object.freeze([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);
const API_SERVER_BY_DOCUMENT = Object.freeze({
  "custom-launch-v1.json": "https://api.programmable.market",
  "custom-launch-v2.json": "https://api.programmable.market",
  "custom-launch-v3.json": "https://api.programmable.market",
  "custom-launch-v4.json": "https://api.programmable.market",
});
const ROBINHOOD_V4_PLATFORM_FEE_POLICY = Object.freeze({
  required: true,
  status: "required-default-configuration",
  appliesTo: "new-robinhood-v4-api-custom-launches-only",
  changesExistingLaunches: false,
  changesEthereumLaunches: false,
  rateBps: 20,
  ratePpm: 2_000,
  ratePercent: "0.20%",
  recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
  basis: null,
  feeCurrency: null,
  accountingMode: null,
  rounding: null,
  accrual: null,
  claimMechanism: null,
  enforcement: "not-guaranteed-onchain",
  canonicalOnchainEnforcementProven: false,
  guaranteedRevenue: false,
  feeBehaviorClaim: false,
  universalFeeBehaviorClaim: false,
});

const documents = new Map();
for (const [name, filePath] of Object.entries(documentPaths)) {
  const source = await readFile(filePath, "utf8");
  documents.set(name, parseStrictJson(source, { maximumBytes: 10_000_000, maximumDepth: 256 }));
}

for (const [name, document] of documents) {
  assert.equal(document.openapi, "3.1.0", `${name} must use OpenAPI 3.1.0`);
  assertPlainObject(document.info, `${name} info`);
  assertPlainObject(document.paths, `${name} paths`);
  assertPlainObject(document.components, `${name} components`);
  verifyOpenApiOperations(name, document);
  verifyReferences(name, document);
}

const v3 = documents.get("custom-launch-v3.json");
assert.equal(v3.info.version, "3.3.9", "V3 OpenAPI version is immutable");
assertJsonEqual(v3.security, [{ CustomLaunchApiKey: [] }], "V3 root security");
assertJsonEqual(v3.paths["/v3/capabilities"].get.security, [], "capabilities security");
assertJsonEqual(
  v3.paths["/v3/finalized-custom-launches"].get.security,
  [],
  "finalized metadata security",
);

const v4 = documents.get("custom-launch-v4.json");
assert.equal(v4.info.version, "4.0.0", "Historical V4 OpenAPI version is immutable");
assertJsonEqual(v4.security, [{ CustomLaunchApiKey: [] }], "V4 root security");
for (const pathName of [
  "/v4/chains/{chainId}/capabilities",
  "/v4/chains/{chainId}/custom-launches/preflight",
  "/v4/chains/{chainId}/custom-launches",
  "/v4/chains/{chainId}/custom-launches/{launchId}",
  "/v4/chains/{chainId}/finalized-custom-launches",
]) {
  assertPlainObject(v4.paths[pathName], `V4 path ${pathName}`);
}
assertJsonEqual(
  v4.paths["/v4/chains/{chainId}/capabilities"].get.security,
  [],
  "V4 capabilities security",
);
assertJsonEqual(
  v4.paths["/v4/chains/{chainId}/finalized-custom-launches"].get.security,
  [],
  "V4 finalized metadata security",
);
assert.equal(
  v4.components.schemas.CustomLaunchCreateRequestV4.properties.schemaVersion.const,
  "programmable.custom-launch-create-request.v4",
  "V4 create schema name",
);
assert.equal(
  v4.components.schemas.CustomLaunchCapabilitiesV2.properties.schemaVersion.const,
  "programmable.custom-launch-capabilities.v2",
  "V4 capabilities schema name",
);
assert.equal(
  v4.components.schemas.CustomLaunchPreflightV2.properties.schemaVersion.const,
  "programmable.custom-launch-preflight.v2",
  "V4 preflight schema name",
);
assert.equal(
  v4.components.schemas.CustomLaunchResourceV4.properties.schemaVersion.const,
  "programmable.custom-launch.v4",
  "V4 resource schema name",
);
assert.equal(
  v4.components.schemas.SourceVerificationStatusV4.properties.schemaVersion.const,
  "programmable.source-verification-status.v4",
  "V4 source-verification schema name",
);
assert.equal(
  v4.components.schemas.CustomLaunchOnchainEvidenceV2.properties.schemaVersion.const,
  "programmable.custom-launch-onchain-evidence.v2",
  "V4 historical evidence schema name",
);
assert.equal(
  v4.components.schemas.CustomLaunchOnchainEvidenceV3.properties.schemaVersion.const,
  "programmable.custom-launch-onchain-evidence.v3",
  "V4 current evidence schema name",
);
const authenticatedOnchain = v4.components.schemas.CustomLaunchResourceV4.properties.onchain;
assertJsonEqual(
  authenticatedOnchain.oneOf[0].oneOf.map((schema) => schema.properties.schemaVersion.const),
  [
    "programmable.custom-launch-onchain-evidence.v2",
    "programmable.custom-launch-onchain-evidence.v3",
  ],
  "V4 authenticated resource historical/current evidence compatibility",
);
assertJsonEqual(
  authenticatedOnchain.oneOf[1],
  { type: "null" },
  "V4 authenticated resource nullable pre-inclusion evidence",
);
for (const [componentName, schemaVersion] of [
  ["CustomLaunchL2InclusionV1", "programmable.custom-launch-l2-inclusion.v1"],
  ["CustomLaunchL1PostingV1", "programmable.custom-launch-l1-posting.v1"],
  [
    "CustomLaunchL1FinalizedCheckpointV1",
    "programmable.custom-launch-l1-finalized-checkpoint.v1",
  ],
]) {
  assert.equal(
    v4.components.schemas[componentName].properties.schemaVersion.const,
    schemaVersion,
    `${componentName} schema name`,
  );
}
assert.equal(
  v4.components.schemas.CustomLaunchL1PostingV1.properties.rollup.const,
  "0x23A19d23e89166adedbDcB432518AB01e4272D94",
  "V4 L1 posting rollup trust root",
);
assert.equal(
  v4.components.schemas.CustomLaunchL1PostingV1.properties.sequencerInbox.const,
  "0xBd0D173EEb87D57A09521c24388a12789F33ba96",
  "V4 L1 posting inbox trust root",
);
assertJsonEqual(
  v4.components.schemas.CustomLaunchL1FinalizedCheckpointV1.properties
    .providerReadbacks.prefixItems.map((schema) => [
      schema.properties.providerId.const,
      schema.properties.trustDomain.const,
    ]),
  [["drpc", "drpc.org"], ["quicknode", "quicknode.com"]],
  "V4 finalized Ethereum provider trust roots",
);
assert.equal(
  v4.components.schemas.CustomLaunchFinalizedMetadataV4.properties.platformId.const,
  "programmable",
  "V4 public finalized platform identity",
);
assert.equal(
  v4.components.schemas.CustomLaunchFinalizedMetadataV4.properties.category.const,
  "custom",
  "V4 public finalized category",
);
assert.equal(
  v4.components.schemas.CustomLaunchFinalizedMetadataV4.properties.onchain
    .properties.schemaVersion.const,
  "programmable.custom-launch-onchain-evidence.v3",
  "V4 public finalized evidence requires V3",
);
assert.equal(
  v4.components.schemas.CustomLaunchOnchainEvidenceV3["x-programmable-order"],
  "chainDeploymentDescriptorDigest == keccak256(canonical chainDeployment); router and finalityPolicy match chainDeployment; transactionHash == l2Inclusion.transactionHash; L1 identities match chainDeployment ethereumFinalityEvidence; legacy checkpoint projection follows checkpointType; finalized provider readbacks equal checkpoint",
  "V4 onchain evidence binds embedded Router and finality configuration",
);
assert.equal(
  v4.components.schemas.CustomLaunchFinalizedMetadataV4["x-programmable-order"],
  "chainDeploymentDescriptorDigest, chainDeployment, profile, and commitments equal onchain counterparts",
  "V4 finalized metadata binds outer fields to onchain evidence",
);
assert.equal(
  Object.hasOwn(
    v4.components.schemas.CustomLaunchFinalizedMetadataV4.properties.onchain.properties,
    "walletTransactionPreimageHash",
  ),
  false,
  "V4 public finalized evidence omits the authenticated wallet preimage hash",
);
const finalizedQuality = v4.components.schemas.CustomLaunchFinalizedListV4.properties.quality;
assert.equal(
  v4.components.schemas.CustomLaunchFinalizedListV4["x-programmable-order"],
  "launches.length <= quality.publishedRowCount",
  "V4 finalized page cannot exceed the global published total",
);
assert.equal(
  finalizedQuality["x-programmable-order"],
  "sourceRowCount == publishedRowCount",
  "V4 finalized feed publishes every canonical eligible V3 row",
);
assert.equal(
  finalizedQuality.properties.status.const,
  "ready",
  "V4 successful finalized feed is ready",
);
assert.equal(
  finalizedQuality.properties.quarantinedRowCount.const,
  0,
  "V4 successful finalized feed never quarantines a malformed row",
);
assert.equal(
  v4.components.schemas.ExactWalletTransactionV4.properties.schemaVersion.const,
  "programmable.exact-wallet-transaction.v4",
  "V4 wallet schema name",
);
assertJsonEqual(
  v3.paths["/v3/custom-launches/preflight"].post.security,
  [{ CustomLaunchApiKey: [] }],
  "preflight security",
);
for (const [pathName, method] of [
  ["/v3/custom-launches", "post"],
  ["/v3/custom-launches", "get"],
  ["/v3/custom-launches/{launchId}", "get"],
]) {
  assertPlainObject(v3.paths[pathName]?.[method], `V3 operation ${method.toUpperCase()} ${pathName}`);
}
assertJsonEqual(
  v3.paths["/v3/custom-launches/{launchId}/permit-reissues"].post.security,
  [{ WalletCustomLaunchApiKey: [] }],
  "wallet-only permit-reissue disposition security",
);
assertJsonEqual(
  v3.components.securitySchemes.CustomLaunchApiKey,
  {
    type: "http",
    scheme: "bearer",
    bearerFormat: "pm_live_* | pm_partner_root_<22>_<43> | pm_partner_<22>_<43>",
    description: v3.components.securitySchemes.CustomLaunchApiKey.description,
  },
  "API-key security scheme",
);
assertJsonEqual(
  v3.components.securitySchemes.WalletCustomLaunchApiKey,
  {
    type: "http",
    scheme: "bearer",
    bearerFormat: "pm_live_*",
    description: v3.components.securitySchemes.WalletCustomLaunchApiKey.description,
  },
  "wallet-only API-key security scheme",
);

const publicSchemaPath = path.join(
  repositoryRoot,
  "public/schemas/custom-launch/v3/pack-config.json",
);
const packageSchemaPath = path.join(
  packageRoot,
  "schemas/programmable-launch-pack-config-v3.json",
);
const [publicSchemaBytes, packageSchemaBytes] = await Promise.all([
  readFile(publicSchemaPath),
  readFile(packageSchemaPath),
]);
assert.deepEqual(
  publicSchemaBytes,
  packageSchemaBytes,
  "Public and packaged V3 pack-config schemas must be byte-identical",
);
parseStrictJson(publicSchemaBytes.toString("utf8"), {
  maximumBytes: 10_000_000,
  maximumDepth: 256,
});

const publicV4SchemaRoot = path.join(repositoryRoot, "public/schemas/custom-launch/v4");
const packageV4SchemaPath = path.join(
  packageRoot,
  "schemas/programmable-launch-pack-config-v4.json",
);
const [publicV4PackBytes, packageV4PackBytes] = await Promise.all([
  readFile(path.join(publicV4SchemaRoot, "pack-config.json")),
  readFile(packageV4SchemaPath),
]);
assert.deepEqual(
  publicV4PackBytes,
  packageV4PackBytes,
  "Public and packaged V4 pack-config schemas must be byte-identical",
);
const packageV4Schema = parseStrictJson(packageV4PackBytes.toString("utf8"), {
  maximumBytes: 10_000_000,
  maximumDepth: 256,
});
assertJsonEqual(
  packageV4Schema["x-programmable-contract"].platformFeePolicy,
  ROBINHOOD_V4_PLATFORM_FEE_POLICY,
  "V4 pack annotation must pin the Robinhood API platform fee policy",
);
assert.equal(
  Object.hasOwn(packageV4Schema.$defs, "launchProfile"),
  false,
  "V4 pack schema must not retain the unreachable Ethereum V3 launch profile",
);
assert.equal(
  JSON.stringify(packageV4Schema).includes(
    "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  ),
  false,
  "V4 pack schema must not retain the Ethereum V3 payout recipient",
);
const v4StandaloneComponents = Object.freeze({
  "pack-config.json": "PackConfigV4",
  "custom-launch-create-request.json": "CustomLaunchCreateRequestV4",
  "custom-launch.json": "CustomLaunchResourceV4",
  "source-verification-status.json": "SourceVerificationStatusV4",
  "capabilities.json": "CustomLaunchCapabilitiesV2",
  "preflight.json": "CustomLaunchPreflightV2",
  "onchain-evidence.json": "CustomLaunchOnchainEvidenceV3",
  "exact-wallet-transaction.json": "ExactWalletTransactionV4",
});
for (const [schemaName, componentName] of Object.entries(v4StandaloneComponents)) {
  const schema = parseStrictJson(
    await readFile(path.join(publicV4SchemaRoot, schemaName), "utf8"),
    { maximumBytes: 10_000_000, maximumDepth: 256 },
  );
  assert.equal(
    typeof schema.$id === "string" && schema.$id.endsWith(`/${schemaName}`),
    true,
    `${schemaName} must have its canonical public ID`,
  );
  assertJsonEqual(
    v4.components.schemas[componentName],
    schema,
    `${schemaName} and V4 OpenAPI ${componentName}`,
  );
  visit(schema, (reference) => {
    assert.ok(
      reference.startsWith("#/"),
      `${schemaName} must be self-contained and cannot reference ${reference}`,
    );
  });
}
assert.equal(
  v4.components.schemas.CustomLaunchCapabilitiesV2
    .properties.metadataImage.properties.maximumPixels.const,
  4_194_304,
  "V4 metadata image admission must cap decoded pixels at 4,194,304",
);
assert.equal(
  v4.components.schemas.CustomLaunchCapabilitiesV2
    .properties.walletHandoff.properties.walletHandoffBaseUrl.const,
  "https://programmable.market/developers/api-keys",
  "V4 wallet handoff must publish the exact owner-action base URL",
);
assertJsonEqual(
  v4.components.schemas.CustomLaunchCapabilitiesV2.properties.safety.properties,
  {
    serverAuthoritative: { const: true },
    clientBypassAccepted: { const: false },
    walletSignatureProduced: { const: false },
    transactionBroadcast: { const: false },
    feeBehaviorClaim: { const: false },
    universalFeeBehaviorClaim: { const: false },
    genericClaimingLive: { const: false },
  },
  "V4 capabilities must preserve the non-claiming safety contract",
);
const packagedExternalContract = v4.components.schemas.PackConfigV4.$defs.externalContract;
assert.equal(
  packagedExternalContract.properties.startBlock.$ref,
  "#/$defs/nonzeroUintString",
  "V4 packaged external contract startBlock must be positive",
);
assert.equal(
  v4.components.schemas.PackConfigV4.$defs.externalContractImplementation
    .properties.startBlock.$ref,
  "#/$defs/nonzeroUintString",
  "V4 packaged external implementation startBlock must be positive",
);
const transportExternalContract = v4.components.schemas.CustomLaunchCreateRequestV4
  .properties.externalContracts.items;
assert.equal(
  transportExternalContract.properties.startBlock.pattern,
  "^[1-9][0-9]*$",
  "V4 transport external contract startBlock must be positive",
);
const transportExternalImplementation = transportExternalContract.properties.mutability
  .properties.implementation.oneOf.find((candidate) => candidate.type === "object");
assert.equal(
  transportExternalImplementation.properties.startBlock.pattern,
  "^[1-9][0-9]*$",
  "V4 transport external implementation startBlock must be positive",
);
const v4ProfileSchema = v4.components.schemas.ExactWalletTransactionV4.properties.profile;
assert.equal(
  v4ProfileSchema.properties.admissionSchemaDigest.const,
  "sha256:a28a6de6208d6ba7b65b4b706174509570955ba9ce9714624bcb2046ab7beae7",
  "V4 profile must pin its admission schema digest",
);
assert.equal(
  v4ProfileSchema.properties.profileDigest.const,
  "sha256:484b1dc6e9091804fabc230f2b3a7504940fa00264f8e66e82a66a951e71f1a0",
  "V4 profile must pin the complete canonical profile digest",
);
const chainDeploymentSchema = v4.components.schemas.ExactWalletTransactionV4
  .properties.chainDeployment;
assert.equal(
  chainDeploymentSchema["x-programmable-order"],
  "contracts bind atomic deployment, Permit2 genesis, Safe permit authority, and external root evidence; atomic provider transactionHash copies equal deploymentEvidence.transactionHash; atomic deployment, Safe snapshot, and Ethereum finality agree; programmable Router != universal Router",
  "V4 chain deployment must bind every contract to authoritative evidence",
);
assertJsonEqual(
  v4.components.schemas.PackConfigV4.$defs.chainDeployment,
  chainDeploymentSchema,
  "V4 packaged and transport chain-deployment contracts",
);
const expectedV4TrustRoots = {
  programmableLaunchStampRouter: {
    address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
    runtimeCodeHash: "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
  },
  permitAuthority: {
    address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
    runtimeCodeHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  },
  graphFactory: {
    address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
    runtimeCodeHash: "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  },
  poolManager: {
    address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    runtimeCodeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  },
  positionManager: {
    address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
    runtimeCodeHash: "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
  },
  stateView: {
    address: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    runtimeCodeHash: "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
  },
  v4Quoter: {
    address: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
    runtimeCodeHash: "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
  },
  permit2: {
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    runtimeCodeHash: "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
  },
  universalRouter: {
    address: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
    runtimeCodeHash: "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
  },
};
assertJsonEqual(
  Object.fromEntries(Object.entries(chainDeploymentSchema.properties.contracts.properties)
    .map(([name, binding]) => [name, {
      address: binding.properties.address.const,
      runtimeCodeHash: binding.properties.runtimeCodeHash.const,
    }])),
  expectedV4TrustRoots,
  "V4 chain deployment contract bindings must const-pin all nine trust roots",
);
const atomicDeploymentEvidence = chainDeploymentSchema.properties.deploymentEvidence;
assertClosedSchemaFields(atomicDeploymentEvidence, [
  "schemaVersion", "deploymentId", "chainId", "coveredContracts", "transactionHash",
  "from", "to", "valueWei", "selector", "calldataHash", "calldataBytes", "nonce",
  "transactionIndex", "receiptStatus", "blockNumber", "blockHash", "receiptLogs",
  "receiptLogsDigest", "providerReadbacks", "resultingContracts",
  "ethereumFinalityEvidence", "evidenceDigest", "sourceVerification",
], "V4 atomic root deployment evidence");
assertJsonEqual(
  {
    schemaVersion: atomicDeploymentEvidence.properties.schemaVersion.const,
    deploymentId: atomicDeploymentEvidence.properties.deploymentId.const,
    chainId: atomicDeploymentEvidence.properties.chainId.const,
    coveredContracts: atomicDeploymentEvidence.properties.coveredContracts.const,
    from: atomicDeploymentEvidence.properties.from.enum,
    to: atomicDeploymentEvidence.properties.to.const,
    valueWei: atomicDeploymentEvidence.properties.valueWei.const,
    selector: atomicDeploymentEvidence.properties.selector.const,
    calldataHash: atomicDeploymentEvidence.properties.calldataHash.const,
    calldataBytes: atomicDeploymentEvidence.properties.calldataBytes.const,
    receiptStatus: atomicDeploymentEvidence.properties.receiptStatus.const,
  },
  {
    schemaVersion: "programmable.robinhood-atomic-root-deployment-evidence.v1",
    deploymentId: "robinhood-mainnet-custom-launch-v1",
    chainId: "4663",
    coveredContracts: [
      "programmableLaunchStampRouter", "graphFactory", "permitAuthority",
    ],
    from: [
      "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
      "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
    ],
    to: "0xcA11bde05977b3631167028862bE2a173976CA11",
    valueWei: "0",
    selector: "0x82ad56cb",
    calldataHash:
      "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9",
    calldataBytes: 33_412,
    receiptStatus: "1",
  },
  "V4 atomic deployment transaction pin",
);
assert.equal(
  atomicDeploymentEvidence.properties.receiptLogs.maxItems,
  1_024,
  "V4 atomic receipt logs must be bounded",
);
assert.equal(
  atomicDeploymentEvidence.properties.receiptLogs["x-programmable-order"],
  "strictly increasing logIndex; unique",
  "V4 atomic receipt logs must publish their canonical ordering rule",
);
assert.equal(
  atomicDeploymentEvidence["x-programmable-order"],
  "resultingContracts providerReadbacks prove blockNumber - 1 -> blockNumber",
  "V4 atomic result readbacks must publish their exact D-1 to D invariant",
);
assertClosedSchemaFields(
  atomicDeploymentEvidence.properties.receiptLogs.items,
  ["address", "topics", "data", "logIndex"],
  "V4 atomic receipt log",
);
assert.deepEqual(
  atomicDeploymentEvidence.properties.providerReadbacks.prefixItems.map((provider) => ({
    providerId: provider.properties.providerId.const,
    trustDomain: provider.properties.trustDomain.const,
  })),
  [
    { providerId: "quicknode", trustDomain: "quicknode.com" },
    { providerId: "alchemy", trustDomain: "alchemy.com" },
  ],
  "V4 atomic deployment providers must be the exact ordered production quorum",
);
assert.deepEqual(
  atomicDeploymentEvidence.properties.resultingContracts.prefixItems.map((result) => ({
    contract: result.properties.contract.const,
    address: result.properties.address.const,
    runtimeCodeHash: result.properties.runtimeCodeHash.const,
    previousBlockRuntimeCodeHash: result.properties.previousBlockRuntimeCodeHash.const,
  })),
  [
    {
      contract: "permitAuthority",
      address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
      runtimeCodeHash:
        "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
      previousBlockRuntimeCodeHash:
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    },
    {
      contract: "graphFactory",
      address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
      runtimeCodeHash:
        "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
      previousBlockRuntimeCodeHash:
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    },
    {
      contract: "programmableLaunchStampRouter",
      address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
      runtimeCodeHash:
        "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
      previousBlockRuntimeCodeHash:
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    },
  ],
  "V4 atomic deployment result tuple",
);
for (const result of atomicDeploymentEvidence.properties.resultingContracts.prefixItems) {
  const contract = result.properties.contract.const;
  assertJsonEqual(
    expectedV4TrustRoots[contract],
    {
      address: result.properties.address.const,
      runtimeCodeHash: result.properties.runtimeCodeHash.const,
    },
    `V4 atomic ${contract} result must bind its chain-deployment trust root`,
  );
  assertClosedSchemaFields(result, [
    "contract", "address", "runtimeCodeHash", "previousBlockRuntimeCodeHash",
    "providerReadbacks", "stateEvidenceDigest",
  ], `V4 atomic ${contract} result state`);
  assert.deepEqual(
    result.properties.providerReadbacks.prefixItems.map((provider) => ({
      schemaVersion: provider.properties.schemaVersion.const,
      providerId: provider.properties.providerId.const,
      trustDomain: provider.properties.trustDomain.const,
      contract: provider.properties.contract.const,
      address: provider.properties.address.const,
      preDeploymentRuntimeCodeHash:
        provider.properties.preDeploymentRuntimeCodeHash.const,
      deploymentRuntimeCodeHash: provider.properties.deploymentRuntimeCodeHash.const,
    })),
    [
      { providerId: "quicknode", trustDomain: "quicknode.com" },
      { providerId: "alchemy", trustDomain: "alchemy.com" },
    ].map(({ providerId, trustDomain }) => ({
      schemaVersion:
        "programmable.robinhood-atomic-root-runtime-transition-provider-readback.v1",
      providerId,
      trustDomain,
      contract,
      address: result.properties.address.const,
      preDeploymentRuntimeCodeHash:
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      deploymentRuntimeCodeHash: result.properties.runtimeCodeHash.const,
    })),
    `V4 atomic ${contract} ordered D-1 to D provider readbacks`,
  );
  for (const [index, provider] of result.properties.providerReadbacks.prefixItems.entries()) {
    assertClosedSchemaFields(provider, [
      "schemaVersion", "providerId", "trustDomain", "contract", "address",
      "preDeploymentBlockNumber", "preDeploymentBlockHash",
      "preDeploymentRuntimeCodeHash", "deploymentBlockNumber",
      "deploymentBlockHash", "deploymentRuntimeCodeHash", "evidenceDigest",
    ], `V4 atomic ${contract} provider transition ${index}`);
  }
}
assertJsonEqual(
  Object.fromEntries(Object.entries(
    atomicDeploymentEvidence.properties.sourceVerification.properties,
  ).map(([name, schema]) => [name, schema.const])),
  {
    sourcifyProviderMatchCoveredContracts: [
      "programmableLaunchStampRouter", "graphFactory",
    ],
    exactByteSourceBuildTransactionCoveredContracts: [
      "programmableLaunchStampRouter", "graphFactory",
    ],
    officialSourcePinnedCoveredContracts: ["permitAuthority"],
  },
  "V4 atomic deployment source split",
);
const permit2GenesisProvenance = chainDeploymentSchema.properties.permit2GenesisProvenance;
assert.equal(
  permit2GenesisProvenance["x-programmable-order"],
  "providerReadbacks[0].blockHash == providerReadbacks[1].blockHash",
  "V4 Permit2 schema must publish its cross-provider genesis-block invariant",
);
assertClosedSchemaFields(permit2GenesisProvenance, [
  "schemaVersion", "kind", "address", "startBlock", "genesisSourceUrl",
  "genesisSourceDigest", "allocRuntimeCodeBytes", "providerReadbacks", "evidenceDigest",
], "V4 Permit2 genesis provenance");
assert.equal(
  permit2GenesisProvenance.properties.address.const,
  "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  "V4 Permit2 genesis provenance must pin the canonical predeploy",
);
assert.equal(
  permit2GenesisProvenance.properties.startBlock.const,
  "0",
  "V4 Permit2 genesis provenance is the sole block-zero contract binding",
);
assert.equal(
  permit2GenesisProvenance.properties.genesisSourceUrl.const,
  "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/chain-node-configs/robinhood-genesis.json",
  "V4 Permit2 genesis provenance must pin the official genesis document",
);
assert.equal(
  permit2GenesisProvenance.properties.genesisSourceDigest.const,
  "sha256:353e6f6441b47695b41cee0c3645cde8dd7492d2f7f574bfb6aa4371e41bb6ba",
  "V4 Permit2 genesis provenance must pin the exact genesis bytes",
);
assert.equal(
  permit2GenesisProvenance.properties.allocRuntimeCodeBytes.const,
  9_152,
  "V4 Permit2 genesis provenance must pin the alloc runtime byte length",
);
assert.deepEqual(
  permit2GenesisProvenance.properties.providerReadbacks.prefixItems.map((provider) => ({
    providerId: provider.properties.providerId.const,
    trustDomain: provider.properties.trustDomain.const,
    blockNumber: provider.properties.blockNumber.const,
    runtimeCodeHash: provider.properties.runtimeCodeHash.const,
  })),
  [
    {
      providerId: "quicknode",
      trustDomain: "quicknode.com",
      blockNumber: "0",
      runtimeCodeHash:
        "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
    },
    {
      providerId: "alchemy",
      trustDomain: "alchemy.com",
      blockNumber: "0",
      runtimeCodeHash:
        "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
    },
  ],
  "V4 Permit2 genesis readbacks must be the exact ordered production quorum",
);
assertJsonEqual(
  expectedV4TrustRoots.permit2,
  {
    address: permit2GenesisProvenance.properties.address.const,
    runtimeCodeHash: permit2GenesisProvenance.properties
      .providerReadbacks.prefixItems[0].properties.runtimeCodeHash.const,
  },
  "V4 Permit2 trust root must bind its genesis provenance",
);
const externalRootDeploymentEvidence = chainDeploymentSchema
  .properties.externalRootDeploymentEvidence;
const expectedExternalRoots = [
  {
    contract: "poolManager",
    address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    runtimeCodeHash:
      "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
    transactionHash:
      "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41",
    startBlock: "9070",
  },
  {
    contract: "positionManager",
    address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
    runtimeCodeHash:
      "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
    transactionHash:
      "0x228c18ada6cb46b4fbcc18f4ec1519953415393e256fa8349aafbd5a2db037c8",
    startBlock: "9073",
  },
  {
    contract: "stateView",
    address: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    runtimeCodeHash:
      "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
    transactionHash:
      "0x3d61e2c9eeb482385b1aa436b9e8f812167ea579cc390e4f93bc5abde00582f4",
    startBlock: "9075",
  },
  {
    contract: "v4Quoter",
    address: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
    runtimeCodeHash:
      "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
    transactionHash:
      "0x6bf436d72a17f87284ddcab43094689bd320dfb39b535213b9a0b669fabc4ab4",
    startBlock: "9074",
  },
  {
    contract: "universalRouter",
    address: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
    runtimeCodeHash:
      "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
    transactionHash:
      "0xdfb76494e158d8dea4376160315239271636a18515207fd4526e574bc7eeb456",
    startBlock: "3347899",
  },
];
assert.equal(
  externalRootDeploymentEvidence.items,
  false,
  "V4 external root deployment evidence must be a closed positional tuple",
);
assert.equal(
  externalRootDeploymentEvidence.minItems,
  expectedExternalRoots.length,
  "V4 external root deployment tuple minimum length",
);
assert.equal(
  externalRootDeploymentEvidence.maxItems,
  expectedExternalRoots.length,
  "V4 external root deployment tuple maximum length",
);
assert.deepEqual(
  externalRootDeploymentEvidence.prefixItems.map((entry) => ({
    contract: entry.properties.contract.const,
    address: entry.properties.address.const,
    runtimeCodeHash: entry.properties.runtimeCodeHash.const,
    transactionHash: entry.properties.transactionHash.const,
    startBlock: entry.properties.startBlock.const,
  })),
  expectedExternalRoots,
  "V4 external roots must be the exact ordered Uniswap registry deployments",
);
const expectedRegistrySource = {
  repository: "Uniswap/contracts",
  commit: "4cfc406c8e34da3ce04e60657a7825075b64fd22",
  path: "deployments/json/4663.json",
  rawUrl:
    "https://raw.githubusercontent.com/Uniswap/contracts/4cfc406c8e34da3ce04e60657a7825075b64fd22/deployments/json/4663.json",
  sha256: "sha256:21964cefbfc24b0ee89e7427acf74d223ce5a50aeb4216a9bac361a6148dea15",
};
for (const [index, entry] of externalRootDeploymentEvidence.prefixItems.entries()) {
  const expectedRoot = expectedExternalRoots[index];
  assertJsonEqual(
    expectedV4TrustRoots[expectedRoot.contract],
    {
      address: entry.properties.address.const,
      runtimeCodeHash: entry.properties.runtimeCodeHash.const,
    },
    `V4 external ${expectedRoot.contract} evidence must bind its trust root`,
  );
  assertClosedSchemaFields(entry, [
    "schemaVersion", "contract", "kind", "address", "runtimeCodeHash",
    "transactionHash", "previousBlockNumber", "previousBlockHash",
    "previousBlockRuntimeCodeHash", "startBlock", "blockHash",
    "registrySource", "providerReadbacks", "evidenceDigest",
  ], `V4 external root deployment evidence ${expectedRoot.contract}`);
  assert.equal(
    entry["x-programmable-order"],
    "previousBlockNumber + 1 == startBlock; "
      + "previousBlockNumber == providerReadbacks[*].previousBlockNumber; "
      + "previousBlockHash == providerReadbacks[*].previousBlockHash; "
      + "startBlock == providerReadbacks[*].blockNumber; "
      + "blockHash == providerReadbacks[*].blockHash; "
      + "providerReadbacks[0].rawTransactionDigest == providerReadbacks[1].rawTransactionDigest; "
      + "providerReadbacks[0].transactionDigest == providerReadbacks[1].transactionDigest; "
      + "providerReadbacks[0].transactionReceiptDigest == providerReadbacks[1].transactionReceiptDigest",
    `V4 ${expectedRoot.contract} must publish its dual-provider receipt-block invariant`,
  );
  assertClosedSchemaFields(
    entry.properties.registrySource,
    ["repository", "commit", "path", "rawUrl", "sha256"],
    `V4 ${expectedRoot.contract} registry source`,
  );
  assertJsonEqual(
    Object.fromEntries(Object.entries(entry.properties.registrySource.properties)
      .map(([name, schema]) => [name, schema.const])),
    expectedRegistrySource,
    `V4 ${expectedRoot.contract} registry source`,
  );
  entry.properties.providerReadbacks.prefixItems.forEach((provider, providerIndex) => {
    assertClosedSchemaFields(provider, [
      "providerId", "trustDomain", "transactionHash", "rawTransactionDigest", "transactionDigest",
      "previousBlockNumber", "previousBlockHash", "previousBlockRuntimeCodeHash",
      "blockNumber", "blockHash", "runtimeCodeHash", "transactionReceiptDigest",
      "evidenceDigest",
    ], `V4 ${expectedRoot.contract} provider readback ${providerIndex}`);
  });
  assert.deepEqual(
    entry.properties.providerReadbacks.prefixItems.map((provider) => ({
      providerId: provider.properties.providerId.const,
      trustDomain: provider.properties.trustDomain.const,
      transactionHash: provider.properties.transactionHash.const,
      blockNumber: provider.properties.blockNumber.const,
      runtimeCodeHash: provider.properties.runtimeCodeHash.const,
    })),
    [
      { providerId: "quicknode", trustDomain: "quicknode.com", ...expectedRoot },
      { providerId: "alchemy", trustDomain: "alchemy.com", ...expectedRoot },
    ].map(({ providerId, trustDomain, transactionHash, startBlock, runtimeCodeHash }) => ({
      providerId,
      trustDomain,
      transactionHash,
      blockNumber: startBlock,
      runtimeCodeHash,
    })),
    `V4 ${expectedRoot.contract} dual-provider registry readbacks`,
  );
}
const safeConfigurationEvidence = chainDeploymentSchema
  .properties.permitAuthoritySourceProvenance
  .properties.configurationEvidence;
assertJsonEqual(
  {
    address: chainDeploymentSchema.properties.permitAuthoritySourceProvenance
      .properties.address.const,
    sourceCommitment: chainDeploymentSchema.properties.permitAuthoritySourceProvenance
      .properties.sourceCommitment.const,
  },
  {
    address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
    sourceCommitment:
      "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb",
  },
  "V4 PermitAuthority pinned Safe provenance",
);
assertClosedSchemaFields(safeConfigurationEvidence, [
  "schemaVersion", "finalized", "blockNumber", "blockHash", "proxyRuntimeCodeHash",
  "singleton", "fallbackHandler", "owners", "threshold", "nonce", "modules",
  "modulesNext", "guard", "fallbackHandlerRuntimeCodeHash", "singletonSlot",
  "fallbackHandlerSlot", "guardSlot", "primaryProvider", "secondaryProvider",
  "ethereumFinalityEvidence", "atomicRootStateEvidenceDigest", "evidenceDigest",
], "V4 Safe configuration evidence");
assert.equal(
  safeConfigurationEvidence.properties.proxyRuntimeCodeHash.const,
  "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  "V4 Safe evidence must pin the proxy runtime code hash",
);
assertJsonEqual(
  expectedV4TrustRoots.permitAuthority,
  {
    address: chainDeploymentSchema.properties.permitAuthoritySourceProvenance
      .properties.address.const,
    runtimeCodeHash: safeConfigurationEvidence.properties.proxyRuntimeCodeHash.const,
  },
  "V4 PermitAuthority trust root must bind its Safe provenance and proxy runtime",
);
assertJsonEqual(
  Object.fromEntries(Object.entries(
    safeConfigurationEvidence.properties.singleton.properties,
  ).map(([name, schema]) => [name, schema.const])),
  {
    address: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    runtimeCodeHash:
      "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
    version: "1.4.1",
    sourceCommitment:
      "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb",
  },
  "V4 Safe evidence singleton",
);
assert.equal(
  safeConfigurationEvidence.properties.fallbackHandler.const,
  "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
  "V4 Safe evidence must pin the fallback handler",
);
assert.equal(
  safeConfigurationEvidence.properties.fallbackHandlerRuntimeCodeHash.const,
  "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
  "V4 Safe evidence must pin the fallback-handler runtime code hash",
);
assert.equal(
  safeConfigurationEvidence.properties.modulesNext.const,
  "0x0000000000000000000000000000000000000001",
  "V4 Safe evidence must pin the module-list sentinel",
);
assertJsonEqual(
  {
    owners: safeConfigurationEvidence.properties.owners.const,
    threshold: safeConfigurationEvidence.properties.threshold.const,
    nonce: safeConfigurationEvidence.properties.nonce.const,
    modules: safeConfigurationEvidence.properties.modules.const,
    guard: safeConfigurationEvidence.properties.guard.const,
  },
  {
    owners: [
      "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
      "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
    ],
    threshold: 1,
    nonce: "0",
    modules: [],
    guard: null,
  },
  "V4 Safe frozen owner and module state",
);
assertJsonEqual(
  {
    singletonSlot: safeConfigurationEvidence.properties.singletonSlot.const,
    fallbackHandlerSlot: safeConfigurationEvidence.properties.fallbackHandlerSlot.const,
    guardSlot: safeConfigurationEvidence.properties.guardSlot.const,
  },
  {
    singletonSlot:
      "0x00000000000000000000000041675c099f32341bf84bfc5382af534df5c7461a",
    fallbackHandlerSlot:
      "0x000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec99",
    guardSlot: `0x${"0".repeat(64)}`,
  },
  "V4 Safe storage-word evidence",
);
const ethereumFinalityEvidence = safeConfigurationEvidence
  .properties.ethereumFinalityEvidence;
assertJsonEqual(
  atomicDeploymentEvidence.properties.ethereumFinalityEvidence,
  ethereumFinalityEvidence,
  "V4 atomic and Safe Ethereum-finality contracts",
);
assert.equal(
  ethereumFinalityEvidence["x-programmable-order"],
  "ethereumFinalizedCheckpoint.blockNumber >= postingBlockNumber",
  "V4 finality schema must publish its cross-field finalized-block invariant",
);
assertClosedSchemaFields(ethereumFinalityEvidence, [
  "schemaVersion", "profile", "l2Checkpoint", "batchNumber", "l2Providers",
  "ethereumProviders", "rollup", "sequencerInbox", "postingTransactionHash",
  "postingBlockNumber", "postingBlockHash", "postingLogIndex",
  "ethereumFinalizedCheckpoint", "observedAt", "captureClosureDigest",
  "postingEventDigest", "l1EvidenceDigest", "evidenceDigest",
], "V4 Robinhood-to-Ethereum finality evidence");
assertJsonEqual(
  ethereumFinalityEvidence.properties.profile,
  v4ProfileSchema,
  "V4 finality evidence profile binding",
);
assert.deepEqual(
  ethereumFinalityEvidence.properties.l2Providers.prefixItems.map((provider) => ({
    providerId: provider.properties.providerId.const,
    trustDomain: provider.properties.trustDomain.const,
  })),
  [
    { providerId: "quicknode", trustDomain: "quicknode.com" },
    { providerId: "alchemy", trustDomain: "alchemy.com" },
  ],
  "V4 finality evidence L2 provider order",
);
assert.deepEqual(
  ethereumFinalityEvidence.properties.ethereumProviders.prefixItems.map((provider) => ({
    providerId: provider.properties.providerId.const,
    trustDomain: provider.properties.trustDomain.const,
  })),
  [
    { providerId: "drpc", trustDomain: "drpc.org" },
    { providerId: "quicknode", trustDomain: "quicknode.com" },
  ],
  "V4 finality evidence Ethereum provider order",
);
assertJsonEqual(
  {
    rollup: ethereumFinalityEvidence.properties.rollup.const,
    sequencerInbox: ethereumFinalityEvidence.properties.sequencerInbox.const,
    finalizedTag:
      ethereumFinalityEvidence.properties.ethereumFinalizedCheckpoint.properties.tag.const,
  },
  {
    rollup: "0x23A19d23e89166adedbDcB432518AB01e4272D94",
    sequencerInbox: "0xBd0D173EEb87D57A09521c24388a12789F33ba96",
    finalizedTag: "finalized",
  },
  "V4 finality evidence frozen rollup roots",
);
for (const requiredField of [
  "apiVersion",
  "chainDeploymentId",
  "chainDeploymentDescriptorDigest",
  "chainDeployment",
  "profile",
  "finalityPolicy",
]) {
  assert.ok(
    v4.components.schemas.ExactWalletTransactionV4.required.includes(requiredField),
    `ExactWalletTransactionV4 must require ${requiredField}`,
  );
}
const externalEvidenceReceipt = v4.components.schemas.CustomLaunchResourceV4
  .properties.externalContractEvidenceReceipt.oneOf.find((candidate) => candidate.type === "object");
const externalEvidenceFields = [
  "schemaVersion", "chainId", "caip2", "deploymentId", "requestHash", "rawRequestSha256",
  "chainDeploymentDescriptorDigest", "profile", "profileDigest", "providers", "references",
  "verified", "findingCodes", "observedAt", "evidenceDigest",
];
assert.equal(externalEvidenceReceipt.additionalProperties, false, "external receipt must be closed");
assert.deepEqual(
  [...externalEvidenceReceipt.required].sort(),
  [...externalEvidenceFields].sort(),
  "external receipt required fields must match the backend DTO",
);
assert.deepEqual(
  Object.keys(externalEvidenceReceipt.properties).sort(),
  [...externalEvidenceFields].sort(),
  "external receipt properties must match the backend DTO",
);
assert.equal(
  Object.hasOwn(externalEvidenceReceipt.properties, "providerProfileDigest"),
  false,
  "external receipt must not expose the internal provider-profile digest",
);
assert.deepEqual(
  externalEvidenceReceipt.properties.providers.prefixItems.map((provider) => ({
    role: provider.properties.role.const,
    providerId: provider.properties.providerId.const,
    trustDomain: provider.properties.trustDomain.const,
  })),
  [
    { role: "primary", providerId: "drpc", trustDomain: "drpc.org" },
    { role: "secondary", providerId: "alchemy", trustDomain: "alchemy.com" },
  ],
  "external receipt providers must be the exact ordered production quorum",
);
assert.equal(
  externalEvidenceReceipt.properties.references.items.additionalProperties,
  false,
  "external reference evidence must be closed",
);
for (const requiredField of [
  "walletTransaction",
  "preparedArtifact",
  "admissionReceipt",
  "simulationReceipt",
  "externalContractEvidenceReceipt",
]) {
  assert.ok(
    v4.components.schemas.CustomLaunchResourceV4.required.includes(requiredField),
    `CustomLaunchResourceV4 must require ${requiredField}`,
  );
}
const sourceVerificationStatusV4 = v4.components.schemas.SourceVerificationStatusV4;
assertClosedSchemaFields(sourceVerificationStatusV4, [
  "schemaVersion", "chainId", "caip2", "chainDeploymentId", "status", "components",
  "updatedAt",
], "V4 source-verification status");
assert.equal(
  sourceVerificationStatusV4.properties.components["x-programmable-order"],
  "unique UTF-8 targetId ascending",
  "V4 source-verification components must publish their deterministic order",
);
assert.equal(
  sourceVerificationStatusV4["x-programmable-order"],
  "updatedAt == max components[*].updatedAt",
  "V4 source-verification aggregate timestamp must be explicit",
);
const exactSourceVerificationComponent = sourceVerificationStatusV4.properties.components.items.oneOf
  .find(({ properties }) => properties.status.const === "exact_match");
assertClosedSchemaFields(exactSourceVerificationComponent, [
  "targetId", "address", "status", "providerObservation", "exactSourceAuthority",
  "exactSourceBinding", "updatedAt",
], "V4 exact source-verification component");
assertClosedSchemaFields(exactSourceVerificationComponent.properties.providerObservation, [
  "provider", "classification", "match", "creationMatch", "runtimeMatch",
  "releaseAuthority", "evidenceDigest",
], "V4 Sourcify provider observation");
assert.equal(
  exactSourceVerificationComponent.properties.providerObservation.properties.releaseAuthority.const,
  false,
  "Sourcify no-CBOR observation must never be release authority",
);
assert.equal(
  exactSourceVerificationComponent.properties.exactSourceAuthority.const,
  "protected-hosted-build-finalized-transaction-bytecode",
  "V4 exact source authority must be the independent composite",
);
assertClosedSchemaFields(exactSourceVerificationComponent.properties.exactSourceBinding, [
  "schemaVersion", "authority", "coveredEvidence", "bindingDigest",
], "V4 exact source composite binding");
assert.equal(
  exactSourceVerificationComponent.properties.exactSourceBinding.properties.schemaVersion.const,
  "programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1",
  "V4 exact source status must bind the canonical composite schema",
);
assert.deepEqual(
  exactSourceVerificationComponent.properties.exactSourceBinding.properties.coveredEvidence.const,
  [
    "protected-source-tree",
    "source-closure",
    "hosted-build-artifact",
    "standard-json-input",
    "compiler-binary",
    "compiler-settings",
    "finalized-creation-transaction",
    "creation-bytecode",
    "runtime-bytecode",
  ],
  "V4 exact source status must publish the full independent evidence closure",
);
assert.equal(
  v4.components.schemas.CustomLaunchResourceV4.required.includes("sourceVerification"),
  false,
  "authenticated V4 resources must preserve pre-finality omission compatibility",
);
assert.ok(
  v4.components.schemas.CustomLaunchFinalizedMetadataV4.required.includes("sourceVerification"),
  "V4 finalized metadata must require source-verification readback",
);
const finalizedSourceVerification = v4.components.schemas.CustomLaunchFinalizedMetadataV4
  .properties.sourceVerification;
assert.equal(
  finalizedSourceVerification.properties.status.const,
  "exact_match",
  "V4 public finalized metadata must require exact aggregate source verification",
);
assert.equal(
  finalizedSourceVerification.properties.components.items.properties.status.const,
  "exact_match",
  "V4 public finalized metadata must require every source component to be exact",
);
assert.deepEqual(
  sourceVerificationStatusV4.properties.status.enum,
  ["queued", "retrying", "exact_match", "needs_attention"],
  "V4 authenticated source history must retain all source-verification states",
);
assertV4ListEnvelope(
  v4,
  "/v4/chains/{chainId}/custom-launches",
  "CustomLaunchListV4",
);
assertV4ListEnvelope(
  v4,
  "/v4/chains/{chainId}/finalized-custom-launches",
  "CustomLaunchFinalizedListV4",
);

const [packageManifestSource, shrinkwrapSource, licenseSource, readmeSource, v4ExampleReadmeSource] = await Promise.all([
  readFile(path.join(packageRoot, "package.json"), "utf8"),
  readFile(path.join(packageRoot, "npm-shrinkwrap.json"), "utf8"),
  readFile(path.join(packageRoot, "LICENSE"), "utf8"),
  readFile(path.join(packageRoot, "README.md"), "utf8"),
  readFile(path.join(packageRoot, "examples/robinhood-v4-no-broadcast/README.md"), "utf8"),
]);
const packageManifest = parseStrictJson(packageManifestSource);
const shrinkwrap = parseStrictJson(shrinkwrapSource, { maximumBytes: 5_000_000 });
assert.equal(packageManifest.version, PACKAGE_VERSION, "package version must match CLI version");
assert.equal(packageManifest.license, "MIT", "public CLI package must declare MIT");
assert.ok(
  Array.isArray(packageManifest.files) && packageManifest.files.includes("npm-shrinkwrap.json"),
  "package must ship npm-shrinkwrap.json",
);
assert.ok(
  packageManifest.files.includes("README.md"),
  "package must ship the version-status README",
);
assert.equal(typeof packageManifest.scripts?.sbom, "string", "package must expose an SBOM command");
assert.equal(shrinkwrap.version, PACKAGE_VERSION, "shrinkwrap version must match CLI version");
assert.equal(shrinkwrap.packages?.[""]?.license, packageManifest.license, "shrinkwrap license drift");
assertJsonEqual(
  shrinkwrap.packages?.[""]?.dependencies,
  packageManifest.dependencies,
  "shrinkwrap runtime dependencies",
);
assert.match(licenseSource, /^MIT License\n/u, "CLI license file must contain the MIT grant");
assert.match(
  readmeSource,
  /## Verify the historical Ethereum 3\.3\.9 release/u,
  "packaged README must identify the earlier Ethereum release as historical",
);
assert.match(
  readmeSource,
  /historical CLI `3\.3\.9` artifact for profile `3\.3\.0` compatibility/u,
  "packaged README must bind the historical V3 CLI to its compatible profile",
);
assert.match(
  readmeSource,
  /For fresh Ethereum packs, read current capabilities and verify a published client supporting that exact profile\./u,
  "packaged README must direct new Ethereum packs to the active profile and a compatible published client",
);
assertV4ReleaseInstructions(readmeSource, "packaged README");
assertV4ReleaseInstructions(v4ExampleReadmeSource, "V4 example README");
assert.doesNotMatch(
  readmeSource,
  /github\.com\/0xprogrammable(?:\/|$)/iu,
  "packaged README must not link the retired GitHub organization",
);
assert.match(
  readmeSource,
  /github\.com\/programmablehq\/PROGRAMMABLE\/releases\/download\/programmable-launch-v3\.3\.9/u,
  "packaged README must retain the canonical published V3 release URL",
);

export function assertV4ReleaseInstructions(source, label = "V4 release instructions") {
  const sections = source.match(
    /\*\*Blocked:\*\* ([\s\S]*?)\n\n\*\*Activated:\*\* ([\s\S]*?)(?:\n\n|$)/u,
  );
  assert.ok(sections, `${label} must separately explain blocked and conditional activation states`);
  const [, blocked, activated] = sections;
  assert.match(source, /customLaunchApi\.versions\.v4/u, `${label} must select V4 discovery`);
  assert.match(source, /`chains`/u, `${label} must check chain discovery`);
  assert.match(blocked, /^If either\b/u, `${label} must block if either discovery entry fails`);
  assert.match(activated, /^Only when both discovery entries have\b/u,
    `${label} must require both discovery entries before activation`);
  for (const gate of ["publicAuthorization", "publicWrites", "releaseReady"]) {
    assert.ok(blocked.includes(`\`${gate}: false\``), `${label} must block on ${gate}: false`);
    assert.ok(activated.includes(`\`${gate}: true\``), `${label} must require ${gate}: true`);
  }
  assert.match(blocked, /missing/u, `${label} must block missing release evidence`);
  assert.match(blocked, /stop before authenticated\s+preflight\s+or submission/u,
    `${label} must stop before authenticated requests while blocked`);
  assert.match(blocked, /pending-public-discovery-promotion/u,
    `${label} must explain pending discovery without claiming it is permanent`);
  for (const pattern of [
    /published immutable GitHub Release `programmable-launch-v4\.0\.0`/u,
    /`programmablehq\/PROGRAMMABLE`/u,
    /release manifest/u,
    /exact source commit/u,
    /tarball checksum/u,
    /If any check fails,\s*stop/u,
    /conditional procedure does not assert today's release state/u,
  ]) assert.match(activated, pattern, `${label} must bind activated use to verified release evidence`);
  for (const [url] of source.matchAll(
    /https:\/\/github\.com\/[^\s)<>]+\/releases\/download\/programmable-launch-v4\.0\.0\/[^\s)<>]+/gu,
  )) {
    assert.ok(activated.includes(url), `${label} must gate V4 download URLs inside conditional activation`);
    assert.match(url,
      /^https:\/\/github\.com\/programmablehq\/PROGRAMMABLE\/releases\/download\/programmable-launch-v4\.0\.0\/programmable-launch-4\.0\.0\.(?:tgz(?:\.sha256)?|release\.json|cdx\.json)$/u,
      `${label} must use canonical exact-version V4 release assets`);
  }
}

const forbiddenOriginFlag = "--api-origin";
for (const relativePath of [
  "src/cli.mjs",
  "README.md",
  "examples/direct-native-v3-no-broadcast/project/submit-unsigned-challenge.mjs",
]) {
  const source = await readFile(path.join(packageRoot, relativePath), "utf8");
  assert.equal(
    source.includes(forbiddenOriginFlag),
    false,
    `${relativePath} must not expose an authenticated API-origin override`,
  );
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: "programmable.public-machine-contract-verification.v1",
  cliVersion: PACKAGE_VERSION,
  openApiDocuments: [...documents.keys()],
  result: "verified",
})}\n`);

function verifyReferences(currentName, root) {
  visit(root, (reference) => {
    const separator = reference.indexOf("#");
    const documentPart = separator === -1 ? reference : reference.slice(0, separator);
    const fragment = separator === -1 ? "" : reference.slice(separator + 1);
    assert.ok(
      documentPart.length === 0
        || /^\.\/custom-launch-v[1234]\.json$/u.test(documentPart)
        || /^https:\/\/programmable\.market\/openapi\/custom-launch-v[1234]\.json$/u.test(documentPart),
      `${currentName} contains unsupported external reference ${reference}`,
    );
    const targetName = documentPart.length === 0
      ? currentName
      : documentPart.startsWith("./")
        ? documentPart.slice(2)
        : documentPart.slice(documentPart.lastIndexOf("/") + 1);
    const target = documents.get(targetName);
    assert.ok(target, `${currentName} contains unsupported external reference ${reference}`);
    assert.ok(fragment.startsWith("/"), `${currentName} reference must use a JSON Pointer: ${reference}`);
    let value = target;
    for (const encodedSegment of fragment.slice(1).split("/")) {
      const segment = encodedSegment.replaceAll("~1", "/").replaceAll("~0", "~");
      assert.ok(
        value !== null && typeof value === "object" && Object.hasOwn(value, segment),
        `${currentName} contains unresolved reference ${reference}`,
      );
      value = value[segment];
    }
  });
}

function verifyOpenApiOperations(name, document) {
  assert.ok(
    Array.isArray(document.servers)
      && document.servers.length === 1
      && document.servers[0]?.url === API_SERVER_BY_DOCUMENT[name],
    `${name} must declare only its canonical production server`,
  );
  const operationIds = new Set();
  for (const [pathName, pathItem] of Object.entries(document.paths)) {
    assert.ok(pathName.startsWith("/"), `${name} path must begin with /: ${pathName}`);
    assertPlainObject(pathItem, `${name} path item ${pathName}`);
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation === undefined) continue;
      assertPlainObject(operation, `${name} ${method.toUpperCase()} ${pathName}`);
      assert.ok(
        typeof operation.operationId === "string" && operation.operationId.length > 0,
        `${name} ${method.toUpperCase()} ${pathName} must have operationId`,
      );
      assert.equal(
        operationIds.has(operation.operationId),
        false,
        `${name} contains duplicate operationId ${operation.operationId}`,
      );
      operationIds.add(operation.operationId);
      assertPlainObject(operation.responses, `${name} ${operation.operationId} responses`);
      const responseStatuses = Object.keys(operation.responses);
      assert.ok(responseStatuses.length > 0, `${name} ${operation.operationId} must declare responses`);
      assert.ok(
        responseStatuses.every((status) => status === "default" || /^[1-5][0-9]{2}$/u.test(status)),
        `${name} ${operation.operationId} contains an invalid response status`,
      );
    }
  }
  assert.ok(operationIds.size > 0, `${name} must declare at least one operation`);
}

function visit(value, onReference) {
  if (Array.isArray(value)) {
    value.forEach((entry) => visit(entry, onReference));
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (typeof value.$ref === "string") onReference(value.$ref);
  Object.values(value).forEach((entry) => visit(entry, onReference));
}

function assertPlainObject(value, label) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} is missing`);
}

function assertJsonEqual(actual, expected, label) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), `${label} does not match`);
}

function assertClosedSchemaFields(schema, expectedFields, label) {
  assert.equal(schema.additionalProperties, false, `${label} must reject extra fields`);
  assert.deepEqual(
    [...schema.required].sort(),
    [...expectedFields].sort(),
    `${label} required fields do not match`,
  );
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [...expectedFields].sort(),
    `${label} properties do not match`,
  );
}

function assertV4ListEnvelope(document, pathName, componentName) {
  assertJsonEqual(
    document.paths[pathName].get.responses["200"].content["application/json"].schema,
    { $ref: `#/components/schemas/${componentName}` },
    `${pathName} response envelope`,
  );
  const schema = document.components.schemas[componentName];
  assert.equal(schema.additionalProperties, false, `${componentName} must reject extra fields`);
  assert.ok(schema.required.includes("launches"), `${componentName} must require launches`);
  assert.ok(schema.required.includes("nextCursor"), `${componentName} must require nextCursor`);
  assert.equal(Object.hasOwn(schema.properties, "items"), false, `${componentName} cannot use items`);
}
