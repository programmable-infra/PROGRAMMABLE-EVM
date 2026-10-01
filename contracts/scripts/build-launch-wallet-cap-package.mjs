import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { validateModuleSubmissionRequest } from "../../packages/classic-modules/src/open-transport.mjs";

// Source packaging only. This script neither signs, submits, deploys nor grants catalog authority.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), destination = process.argv[2];
if (!destination) throw new Error("Usage: node contracts/scripts/build-launch-wallet-cap-package.mjs <output-directory>");
const modulePath = "contracts/src/module-foundation/modules/launch-wallet-cap/LaunchWalletCapV1.sol";
const factoryPath = "contracts/src/module-foundation/modules/launch-wallet-cap/LaunchWalletCapFactoryV1.sol";
const paths = ["contracts/src/module-foundation/FoundationTypesV1.sol", "contracts/src/module-foundation/IFoundationModuleV1.sol", modulePath, factoryPath];
const files = await Promise.all([...paths, "README.md"].map(async path => {
  const value = await readFile(resolve(root, path === "README.md" ? "contracts/spec/module-foundation/launch-wallet-cap-v1.md" : path));
  return { path, sha256: createHash("sha256").update(value).digest("hex"), encoding: "base64", bytes: value.toString("base64") };
}));
const descriptor = {
  moduleId: keccak256(stringToHex("programmable.foundation.launch-wallet-cap.v1")), abiVersion: 1,
  phases: 3, resources: 0, beforeGas: 100_000, afterGas: 100_000, actionGas: 0, failOpenAfter: false,
  exclusiveGroup: keccak256(stringToHex("programmable.foundation.launch-wallet-cap")),
};
const descriptorHash = keccak256(encodeAbiParameters([{ type: "tuple", components: [
  { name: "moduleId", type: "bytes32" }, { name: "abiVersion", type: "uint16" },
  { name: "phases", type: "uint8" }, { name: "resources", type: "uint8" },
  { name: "beforeGas", type: "uint32" }, { name: "afterGas", type: "uint32" },
  { name: "actionGas", type: "uint32" }, { name: "failOpenAfter", type: "bool" }, { name: "exclusiveGroup", type: "bytes32" },
] }], [descriptor]));
const configurationAbi = [{ path: ["supplyLimitBps"], type: "uint16" }, { path: ["durationMinutes"], type: "uint32" }];
const checked = validateModuleSubmissionRequest({
  format: "programmable.modules.submission.v0.1", files,
  descriptor: {
    format: "programmable.classic.source-package.v0.1", name: "Initial wallet buy limit", version: "1.0.0",
    author: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da", rewardWallet: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
    familySalt: keccak256(stringToHex("programmable.foundation.launch-wallet-cap")),
    source: { files: files.map(({ path, sha256 }) => ({ path, sha256 })) },
    components: [
      { id: "module", runtime: "programmable.module-foundation.solidity@1", sourcePath: modulePath, entrypoint: "LaunchWalletCapV1" },
      { id: "factory", runtime: "programmable.module-foundation.solidity@1", sourcePath: factoryPath, entrypoint: "LaunchWalletCapFactoryV1" },
    ],
    configuration: { type: "record", fields: {
      supplyLimitBps: { type: "uint", bits: 16, min: "1", max: "10000", unit: "programmable.percent-bps",
        label: "Supply limit per wallet (%)", help: "All purchases by the same initiating wallet count together. Selling does not reset the allowance. The creator's first buy counts too." },
      durationMinutes: { type: "uint", bits: 32, min: "1", max: "4294967295", unit: "minutes",
        label: "Protection duration (minutes)", help: "Measured from launch. Buys use the official Uniswap router during this time. Afterward, buys are unrestricted." },
    }, required: ["supplyLimitBps", "durationMinutes"] },
    ports: { inputs: {}, outputs: {} }, constraints: [], requiresHost: ["programmable.module-foundation.host@1"], documentation: "README.md",
    management: { summary: "Optional cumulative buy cap per initiating wallet for your chosen launch duration. Percentage and minutes are set at launch. Remove this module for unrestricted buys.",
      reads: [
        { id: "wallet-limit", label: "Wallet token limit", component: "module", entrypoint: "walletTokenLimit", description: "Fixed token amount allowed across all buys during the window." },
        { id: "protection-end", label: "Protection end", component: "module", entrypoint: "protectionEndsAt", description: "Timestamp when buys become unrestricted automatically." },
      ], actions: [] },
    extensions: { "programmable.module-foundation@1": {
      hostAdapterId: "programmable.module-foundation.host@1", descriptor, descriptorHash,
      configurationCodec: "programmable.foundation-abi@1", configurationAbi, defaults: { supplyLimitBps: "200", durationMinutes: "3" }, actions: [],
    } },
  },
});
if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
const output = resolve(destination);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "source-package.json"), `${JSON.stringify(checked.request, null, 2)}\n`);
await writeFile(resolve(output, "source-descriptor.json"), `${JSON.stringify(checked.request.descriptor, null, 2)}\n`);
await writeFile(resolve(output, "candidate.json"), `${JSON.stringify({
  packageId: checked.packageId, familyId: checked.familyId, requestDigest: checked.requestDigest,
  descriptorHash, configurationAbi, approved: false, registryApproved: false, available: false,
}, null, 2)}\n`);
console.log(JSON.stringify({ output, requestDigest: checked.requestDigest, packageId: checked.packageId, available: false }));
