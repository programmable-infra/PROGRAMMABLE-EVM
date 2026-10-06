import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { validateModuleSubmissionRequest } from "../../packages/classic-modules/src/open-transport.mjs";

// Source packaging only. This script neither signs, submits, deploys nor grants catalog authority.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), destination = process.argv[2];
if (!destination) throw new Error("Usage: node contracts/scripts/build-growing-buy-limit-package.mjs <output-directory>");
const modulePath = "contracts/src/module-foundation/modules/growing-buy-limit/GrowingBuyLimitV1.sol";
const factoryPath = "contracts/src/module-foundation/modules/growing-buy-limit/GrowingBuyLimitFactoryV1.sol";
const paths = ["contracts/src/module-foundation/FoundationTypesV1.sol", "contracts/src/module-foundation/IFoundationModuleV1.sol", modulePath, factoryPath];
const files = await Promise.all([...paths, "README.md"].map(async path => {
  const value = await readFile(resolve(root, path === "README.md" ? "contracts/spec/module-foundation/growing-buy-limit-v1.md" : path));
  return { path, sha256: createHash("sha256").update(value).digest("hex"), encoding: "base64", bytes: value.toString("base64") };
}));
const descriptor = {
  moduleId: keccak256(stringToHex("programmable.foundation.growing-buy-limit.v1")), abiVersion: 1,
  phases: 3, resources: 0, beforeGas: 50_000, afterGas: 50_000, actionGas: 0, failOpenAfter: false,
  exclusiveGroup: keccak256(stringToHex("programmable.foundation.growing-buy-limit")),
};
const descriptorHash = keccak256(encodeAbiParameters([{ type: "tuple", components: [
  { name: "moduleId", type: "bytes32" }, { name: "abiVersion", type: "uint16" },
  { name: "phases", type: "uint8" }, { name: "resources", type: "uint8" },
  { name: "beforeGas", type: "uint32" }, { name: "afterGas", type: "uint32" },
  { name: "actionGas", type: "uint32" }, { name: "failOpenAfter", type: "bool" }, { name: "exclusiveGroup", type: "bytes32" },
] }], [descriptor]));
const configurationAbi = [{ path: ["initialLimitBps"], type: "uint16" }, { path: ["finalLimitBps"], type: "uint16" }, { path: ["durationSeconds"], type: "uint32" }];
const checked = validateModuleSubmissionRequest({
  format: "programmable.modules.submission.v0.1", files,
  descriptor: {
    format: "programmable.classic.source-package.v0.1", name: "Growing buy limit", version: "1.0.0",
    author: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da", rewardWallet: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
    familySalt: keccak256(stringToHex("programmable.foundation.growing-buy-limit")),
    source: { files: files.map(({ path, sha256 }) => ({ path, sha256 })) },
    components: [
      { id: "module", runtime: "programmable.module-foundation.solidity@1", sourcePath: modulePath, entrypoint: "GrowingBuyLimitV1" },
      { id: "factory", runtime: "programmable.module-foundation.solidity@1", sourcePath: factoryPath, entrypoint: "GrowingBuyLimitFactoryV1" },
    ],
    configuration: { type: "record", fields: {
      initialLimitBps: { type: "uint", bits: 16, min: "1", max: "10000", unit: "programmable.percent-bps",
        label: "Initial limit per buy (%)", help: "The maximum share of supply in one purchase at launch. Separate purchases count separately." },
      finalLimitBps: { type: "uint", bits: 16, min: "1", max: "10000", unit: "programmable.percent-bps",
        label: "Final limit per buy (%)", help: "The maximum share in one purchase once the growth period ends. It cannot be below the initial limit." },
      durationSeconds: { type: "uint", bits: 32, min: "1", max: "4294967295", unit: "seconds",
        label: "Growth duration (seconds)", help: "The limit grows steadily over this period, then stays at the final limit. Sells remain unrestricted by this module." },
    }, required: ["initialLimitBps", "finalLimitBps", "durationSeconds"] },
    ports: { inputs: {}, outputs: {} }, constraints: [{ id: "growing-limit", message: "The final limit must be at least the initial limit.",
      left: { ref: { instance: "$self", path: ["initialLimitBps"] } }, operator: "lte",
      right: { ref: { instance: "$self", path: ["finalLimitBps"] } } }],
    requiresHost: ["programmable.module-foundation.host@1"], documentation: "README.md",
    management: { summary: "The maximum size of each buy grows from your initial limit to your final limit over the chosen period. Sells remain free. This is a limit per purchase, not a cumulative wallet limit.",
      reads: [
        { id: "current-limit", label: "Current buy limit", component: "module", entrypoint: "currentTokenLimit", description: "The maximum token amount in a single purchase right now." },
        { id: "start", label: "Growth started", component: "module", entrypoint: "startsAt", description: "Launch timestamp from which the limit grows." },
      ], actions: [] },
    extensions: { "programmable.module-foundation@1": {
      hostAdapterId: "programmable.module-foundation.host@1", descriptor, descriptorHash,
      configurationCodec: "programmable.foundation-abi@1", configurationAbi, defaults: { initialLimitBps: "50", finalLimitBps: "500", durationSeconds: "600" }, actions: [],
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
