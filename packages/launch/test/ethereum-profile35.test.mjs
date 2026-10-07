import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { GRAPH_FACTORY } from "../src/constants.mjs";
import { loadCompilationUnits, loadTargetArtifact } from "../src/build.mjs";
import { CANONICAL_SETTLEMENT_FEE_VAULT_V2, validateCanonicalSettlementFeeVaultV2Build } from "../src/canonical-settlement-fee-vault-v2.mjs";
import { validateCanonicalSettlementFeeVaultV1Graph } from "../src/canonical-settlement-fee-vault-v1.mjs";
import { resolveDirectNativeProfile, buildDirectNativeProfileBinding, validateEmbeddedDirectNativeProfile,
  validateDirectNativeProfileBinding, validateDirectNativeProfileGraph } from "../src/profile-direct-native-v1.mjs";
import { sha256Digest } from "../src/io.mjs";

const directory = new URL("../contracts/settlement-fee-vault-v2/", import.meta.url);
const artifact = JSON.parse(readFileSync(new URL("EthereumSettlementFeeVaultV2.artifact.json", directory)));
const compilerInput = readFileSync(new URL("EthereumSettlementFeeVaultV2.standard-json.json", directory));
const zero = "0x0000000000000000000000000000000000000000";

test("3.5 schema discovery points to the V2 artifact accepted by the packer", () => {
  const schema = JSON.parse(readFileSync(new URL("../schemas/programmable-launch-pack-config-v3.5.json", import.meta.url)));
  const discovery = schema["x-programmable-profile-3-5-contract"];
  const feeModule = discovery.canonicalSettlementFeeModule;
  const canonical = CANONICAL_SETTLEMENT_FEE_VAULT_V2;
  assert.equal(schema.properties.profileVersion.const, "3.5.0");
  assert.equal(schema.properties.targets.minItems, 4);
  assert.equal(schema["x-programmable-profile-3-4-contract"], undefined);
  assert.equal(feeModule.moduleId, canonical.moduleId);
  assert.equal(feeModule.releaseBindingSha256, canonical.releaseBindingSha256);
  assert.equal(feeModule.sourceSha256, canonical.source.sha256);
  assert.equal(feeModule.creationBytecodeSha256, canonical.creationBytecode.sha256);
  assert.equal(feeModule.creationBytecodeKeccak256, canonical.creationBytecode.keccak256);
  assert.equal(feeModule.runtimeBytecodeSha256, canonical.runtimeBytecode.sha256);
  assert.equal(feeModule.runtimeBytecodeKeccak256, canonical.runtimeBytecode.keccak256);
});
const selection = { schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3", profileId: "programmable.direct-native-hook-graph.v1",
  profileRevision: 3, targetRoles: { tokenTargetId: "token", hookTargetId: "custom-hook", initializerTargetId: "initializer", platformFeeBindingTargetId: "vault" },
  fundingMode: "none", accountingMode: "inclusive-selected-total", assessmentBase: "executed-gross-declared-quote", feeCurrency: "declared-quote-currency",
  claimMode: "immutable-payout-recipient", payoutRecipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  applicantSelectedBuyHundredthsOfBip: "30000", applicantSelectedSellHundredthsOfBip: "0" };

function fixture() {
  const target = (targetId, componentKind, declaredHookPermissions = null) => ({ targetId, componentKind, declaredHookPermissions,
    applicantSalt: `0x${"00".repeat(32)}`, creationBytecode: "0x60006000", constructorArguments: "0x", initializerCalldata: "0x",
    constructorAddressLocators: [], initializerAddressLocators: [], deploymentValueWei: "0", initializerValueWei: "0", expectedRuntimeCodeHash: `0x${"11".repeat(32)}` });
  const graph = { schemaVersion: "programmable.custom-graph-bundle.v1", sourceBundleSha256: `sha256:${"11".repeat(32)}`,
    targets: [target("token", "token"), { ...target("custom-hook", "hook", ["beforeSwap"]),
      constructorAddressLocators: [{ targetId: "vault", byteOffset: 0, encoding: "abi-address-word" }] }, target("initializer", "other"),
      { ...target("vault", "other"), creationBytecode: artifact.creationBytecode,
        constructorArguments: encodeAbiParameters(parseAbiParameters("address"), [GRAPH_FACTORY]),
        initializerCalldata: `0x8ce2a828${"00".repeat(32)}`,
        initializerAddressLocators: [{ targetId: "custom-hook", byteOffset: 4, encoding: "abi-address-word" }], expectedRuntimeCodeHash: artifact.runtimeTemplateCodeHash }],
    pool: { tokenTargetId: "token", hookTargetId: "custom-hook", quoteCurrency: zero, fee: 0, tickSpacing: 60, initialSqrtPriceX96: "79228162514264337593543950336" } };
  const context = { graphBundle: graph, profileVersion: "3.5.0", predictions: [
    { targetId: "token", predictedAddress: "0x0000000000000000000000000000000000001000" },
    { targetId: "custom-hook", predictedAddress: "0x0000000000000000000000000000000000001080" },
    { targetId: "initializer", predictedAddress: "0x0000000000000000000000000000000000003000" }],
    quoteCurrency: zero, routeNamespace: `0x${"22".repeat(32)}`, routeNonce: `0x${"33".repeat(32)}` };
  const verification = { compilationUnits: [{ compilationUnitId: "vault-unit", compilerVersion: artifact.compiler.version,
    standardJsonInputBase64: compilerInput.toString("base64"), standardJsonInputSha256: sha256Digest(compilerInput) }], components: [{ targetId: "vault",
    compilationUnitId: "vault-unit", contractName: artifact.contractName, sourcePath: artifact.sourcePath,
    runtimeMaterialization: { immutableReferences: [], runtimeImmutables: [], deployedRuntimeCodeBase64: Buffer.from(artifact.runtimeTemplate.slice(2), "hex").toString("base64"),
      deployedRuntimeCodeHash: artifact.runtimeTemplateCodeHash } }] };
  return { graph, context, verification };
}

test("public CLI derives exact 3.5 policy and 3000ppm economics while preserving historical defaults", () => {
  const f = fixture();
  const profile = resolveDirectNativeProfile(selection, { profileVersion: "3.5.0" });
  const binding = buildDirectNativeProfileBinding(selection, f.context);
  assert.equal(profile.graphPolicy.minimumTargets, 4);
  assert.equal(profile.platformFeePolicy.programmableFeeHundredthsOfBip, "3000");
  assert.equal(binding.platformFeeBinding.economics.buy.projectHundredthsOfBip, "27000");
  assert.equal(binding.platformFeeBinding.economics.sell.effectiveTotalHundredthsOfBip, "3000");
  assert.deepEqual(validateEmbeddedDirectNativeProfile(profile), profile);
  assert.deepEqual(validateDirectNativeProfileBinding(binding, f.context), binding);
  assert.doesNotThrow(() => validateDirectNativeProfileGraph(profile, binding, f.graph));
  for (const version of ["3.3.0", "3.4.0"]) {
    assert.equal(resolveDirectNativeProfile(selection, { profileVersion: version }).platformFeePolicy.programmableFeeHundredthsOfBip, "1000");
  }
  assert.throws(() => validateDirectNativeProfileGraph(profile, { ...binding, platformFeeBinding: {
    ...binding.platformFeeBinding, programmableFeeHundredthsOfBip: "1000" } }, f.graph), /embedded policy/);
});

test("public CLI admits only the committed V2 source closure and bytecodes, with V1 validators still frozen", () => {
  const f = fixture();
  assert.equal(validateCanonicalSettlementFeeVaultV2Build(f.graph, f.verification, "vault").moduleId, CANONICAL_SETTLEMENT_FEE_VAULT_V2.moduleId);
  assert.throws(() => validateCanonicalSettlementFeeVaultV1Graph(f.graph, "vault"), /MISMATCH/);
  for (const field of ["creationBytecode", "expectedRuntimeCodeHash", "constructorArguments"]) {
    const changed = structuredClone(f.graph); changed.targets[3][field] = "0x6000";
    assert.throws(() => validateCanonicalSettlementFeeVaultV2Build(changed, f.verification, "vault"), /MISMATCH/);
  }
  const changedVerification = structuredClone(f.verification); changedVerification.compilationUnits[0].standardJsonInputBase64 = Buffer.from("{}").toString("base64");
  assert.throws(() => validateCanonicalSettlementFeeVaultV2Build(f.graph, changedVerification, "vault"), /MISMATCH/);
});

test("packaged V2 build artifact loads with the public packer and exact pinned compiler input", async () => {
  const root = fileURLToPath(directory);
  const units = await loadCompilationUnits([{ compilationUnitId: "vault-unit", standardJson: "EthereumSettlementFeeVaultV2.standard-json.json" }], root);
  const target = await loadTargetArtifact({ targetId: "vault", compilationUnitId: "vault-unit", artifact: "EthereumSettlementFeeVaultV2.build.json",
    applicantSalt: `0x${"00".repeat(32)}`, constructorArguments: [GRAPH_FACTORY], initializer: null,
    deploymentValueWei: "0", initializerValueWei: "0", componentKind: "other", declaredHookPermissions: null, runtimeImmutables: [] },
    0, root, new Map(units.map(unit => [unit.compilationUnitId, unit])), { apiVersion: "v2", requiredCompilerVersion: artifact.compiler.version });
  assert.equal(target.creationBytecode, artifact.creationBytecode);
  assert.equal(target.runtimeCode, artifact.runtimeTemplate);
  assert.equal(target.contractName, "EthereumSettlementFeeVaultV2");
});
