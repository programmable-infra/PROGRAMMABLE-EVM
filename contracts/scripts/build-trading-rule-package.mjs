import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { validateModuleSubmissionRequest } from "../../packages/classic-modules/src/open-transport.mjs";

// Packages source and UI metadata only. No signing, deployment or activation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [id, destination] = process.argv.slice(2);
const definitions = {
  "buy-cooldown": {
    name: "Buy cooldown", contract: "BuyCooldown", phases: 3, gas: 100_000,
    summary: "After a buy, the same wallet must wait before buying again. Sells remain available. The creator's first buy also starts the timer. Buys use the supported router; other wallets have separate timers.",
    fields: { cooldownSeconds: { type: "uint", bits: 32, min: "1", max: "86400", unit: "seconds",
      label: "Time between buys (seconds)", help: "This wait applies after each successful buy for the life of the pool. Selling does not reset it." } },
    abi: [{ path: ["cooldownSeconds"], type: "uint32" }], defaults: { cooldownSeconds: "30" },
    reads: [{ id: "cooldown", label: "Time between buys", component: "module", entrypoint: "cooldownSeconds", description: "Minimum seconds between successful purchases by the same router initiator." }],
  },
  "buy-window": {
    name: "Daily buy window", contract: "BuyWindow", phases: 1, gas: 50_000,
    summary: "Buys open during the same UTC hours each day. Sells remain available all day. A first buy at launch must also be within the open hours. Other time-based rules keep running while buying is closed.",
    fields: {
      startHourUtc: { type: "uint", bits: 8, min: "0", max: "23", unit: "UTC hour", label: "Opening hour (UTC)", help: "Use a whole hour from 0 to 23. UTC does not change with daylight saving time." },
      openHours: { type: "uint", bits: 8, min: "1", max: "23", unit: "hours", label: "Open for (hours)", help: "The window repeats daily and can continue past midnight." },
    },
    abi: [{ path: ["startHourUtc"], type: "uint8" }, { path: ["openHours"], type: "uint8" }], defaults: { startHourUtc: "8", openHours: "12" },
    reads: [
      { id: "open", label: "Buying is open", component: "module", entrypoint: "isBuyOpen", description: "Whether the current block is within the daily buy window." },
      { id: "next", label: "Next buying time", component: "module", entrypoint: "nextBuyTime", description: "The current timestamp while open, or the timestamp of the next opening." },
    ],
  },
  "price-move-guard": {
    name: "Price move guard", contract: "PriceMoveGuard", phases: 3, gas: 100_000,
    summary: "A buy or sell is rejected if it changes this pool's price by more than your limit. This also applies to the first buy. Large trades may need splitting. This does not replace wallet slippage settings or prevent several smaller trades from moving the price further.",
    fields: { maxMoveBps: { type: "uint", bits: 16, min: "1", max: "5000", unit: "programmable.percent-bps",
      label: "Maximum price move per swap (%)", help: "Applies to both buys and sells, relative to the price before that swap. A small limit can make normal trades impractical." } },
    abi: [{ path: ["maxMoveBps"], type: "uint16" }], defaults: { maxMoveBps: "1000" },
    reads: [{ id: "limit", label: "Maximum move in basis points", component: "module", entrypoint: "maxMoveBps", description: "100 basis points is 1 percent." }],
  },
};
if (!destination || !Object.hasOwn(definitions, id)) throw new Error("Usage: node contracts/scripts/build-trading-rule-package.mjs <buy-cooldown|buy-window|price-move-guard> <output-directory>");
const d = definitions[id];
const base = `contracts/src/module-foundation/modules/${id}`;
const modulePath = `${base}/${d.contract}V1.sol`, factoryPath = `${base}/${d.contract}FactoryV1.sol`;
const paths = ["contracts/src/module-foundation/FoundationTypesV1.sol", "contracts/src/module-foundation/IFoundationModuleV1.sol",
  "contracts/src/module-foundation/modules/common/BoundModuleV1.sol", modulePath, factoryPath];
const files = await Promise.all([...paths, "README.md"].map(async path => {
  const bytes = await readFile(resolve(root, path === "README.md" ? `contracts/spec/module-foundation/${id}-v1.md` : path));
  return { path, sha256: createHash("sha256").update(bytes).digest("hex"), encoding: "base64", bytes: bytes.toString("base64") };
}));
const descriptor = { moduleId: keccak256(stringToHex(`programmable.foundation.${id}.v1`)), abiVersion: 1,
  phases: d.phases, resources: 0, beforeGas: d.gas, afterGas: d.phases & 2 ? d.gas : 0, actionGas: 0,
  failOpenAfter: false, exclusiveGroup: keccak256(stringToHex(`programmable.foundation.${id}`)) };
const descriptorHash = keccak256(encodeAbiParameters([{ type: "tuple", components: [
  { name: "moduleId", type: "bytes32" }, { name: "abiVersion", type: "uint16" }, { name: "phases", type: "uint8" },
  { name: "resources", type: "uint8" }, { name: "beforeGas", type: "uint32" }, { name: "afterGas", type: "uint32" },
  { name: "actionGas", type: "uint32" }, { name: "failOpenAfter", type: "bool" }, { name: "exclusiveGroup", type: "bytes32" },
] }], [descriptor]));
const checked = validateModuleSubmissionRequest({ format: "programmable.modules.submission.v0.1", files,
  descriptor: {
    format: "programmable.classic.source-package.v0.1", name: d.name, version: "1.0.0",
    author: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da", rewardWallet: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
    familySalt: keccak256(stringToHex(`programmable.foundation.${id}`)), source: { files: files.map(({ path, sha256 }) => ({ path, sha256 })) },
    components: [
      { id: "module", runtime: "programmable.module-foundation.solidity@1", sourcePath: modulePath, entrypoint: `${d.contract}V1` },
      { id: "factory", runtime: "programmable.module-foundation.solidity@1", sourcePath: factoryPath, entrypoint: `${d.contract}FactoryV1` },
    ],
    configuration: { type: "record", fields: d.fields, required: Object.keys(d.fields) },
    ports: { inputs: {}, outputs: {} }, constraints: [], requiresHost: ["programmable.module-foundation.host@1"], documentation: "README.md",
    management: { summary: d.summary, reads: d.reads, actions: [] },
    extensions: { "programmable.module-foundation@1": { hostAdapterId: "programmable.module-foundation.host@1",
      descriptor, descriptorHash, configurationCodec: "programmable.foundation-abi@1", configurationAbi: d.abi, defaults: d.defaults, actions: [] } },
  },
});
if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
const output = resolve(destination);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "source-package.json"), JSON.stringify(checked.request, null, 2) + "\n");
await writeFile(resolve(output, "candidate.json"), JSON.stringify({ packageId: checked.packageId, familyId: checked.familyId,
  requestDigest: checked.requestDigest, descriptorHash, available: false }, null, 2) + "\n");
console.log(JSON.stringify({ id, packageId: checked.packageId, output, available: false }));
