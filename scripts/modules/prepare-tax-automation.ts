import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeAbiParameters, keccak256, toFunctionSelector, toHex } from "viem";
import {
  FOUNDATION_CAPABILITIES_V1, FOUNDATION_HOST_ADAPTER_ID_V1, FOUNDATION_PACKAGE_EXTENSION_V1,
  FOUNDATION_CONFIGURATION_CODEC_V1, FOUNDATION_ZERO_HASH, createFoundationModuleManifestV1,
  encodeFoundationActionV1, encodeFoundationConfigurationV1, hashFoundationModuleDescriptorV1,
} from "@/lib/module-foundation/manifest";
import { FOUNDATION_HOST_ADAPTER_V1 } from "@/lib/module-foundation/composition";
import { STAGED_TAX_AUTOMATION_HOST_V1, TAX_AUTOMATION_CAPABILITY_V1 } from "@/lib/module-foundation/staged/tax-automation";
import type { OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";

const root = process.cwd();
const output = process.argv[2];
if (!output) throw new Error("Supply an output directory. This script only prepares local source packages.");
const decimals = Number(process.argv[3] ?? "18");
assert(Number.isInteger(decimals) && decimals >= 6 && decimals <= 24, "Use the selected quote token's actual decimals.");
const unit = 10n ** BigInt(decimals);
const sourceRoot = "contracts/src/module-foundation/modules/tax-automation";
const documentation = "docs/module-foundation/tax-automation-staged.md";
const variants = [
  ["tax-to-liquidity", "Tax to liquidity", "TaxToLiquidityV1", "TaxToLiquidityFactoryV1", 10000],
  ["tax-buyback-burn", "Buyback and burn", "TaxBuybackBurnV1", "TaxBuybackBurnFactoryV1", 0],
  ["tax-liquidity-burn", "Liquidity and burn", "TaxLiquidityBurnV1", "TaxLiquidityBurnFactoryV1", 5000],
] as const;
const requirements = [FOUNDATION_HOST_ADAPTER_ID_V1, ...Object.values(FOUNDATION_CAPABILITIES_V1), TAX_AUTOMATION_CAPABILITY_V1];
assert(!FOUNDATION_HOST_ADAPTER_V1.capabilities.includes(TAX_AUTOMATION_CAPABILITY_V1));
assert(requirements.every(capability => STAGED_TAX_AUTOMATION_HOST_V1.capabilities.includes(capability)));
await mkdir(path.resolve(output), { recursive: true });
const packages = [];
for (const [slug, name, moduleName, factoryName, liquidityBps] of variants) {
  const summary = slug === "tax-to-liquidity"
    ? "Your assigned creator fees buy tokens and add both assets to permanently locked liquidity in this coin's pool. Processing runs after eligible trades. Small amounts wait."
    : slug === "tax-buyback-burn"
      ? "Your assigned creator fees buy this coin and burn the bought tokens. Its total supply falls. Processing runs after eligible trades. Small amounts wait."
      : "Your assigned creator fees are split between permanently locked liquidity and buying and burning this coin. You set the split at launch. Processing runs after eligible trades.";
  const descriptor = {
    moduleId: keccak256(toHex(`programmable.foundation.${slug}.v1`)), abiVersion: 1,
    phases: 7, resources: 1, beforeGas: 100_000, afterGas: 650_000, actionGas: 1_500_000,
    failOpenAfter: true, exclusiveGroup: FOUNDATION_ZERO_HASH,
  };
  const files = ["contracts/src/module-foundation/FoundationTypesV1.sol", "contracts/src/module-foundation/IFoundationModuleV1.sol",
    `${sourceRoot}/TaxAutomationBaseV1.sol`, `${sourceRoot}/${moduleName}.sol`, `${sourceRoot}/${factoryName}.sol`, documentation];
  const sourceFiles = await Promise.all(files.map(async file => ({ path: file,
    sha256: createHash("sha256").update(await readFile(path.join(root, file))).digest("hex") })));
  const uint = (bits: number, min: string, max: string, label: string, help: string, unit?: string) =>
    ({ type: "uint", bits, min, max, label, help, ...(unit ? { unit } : {}) });
  const defaults = { minimumQuote: (unit / 1000n).toString(), maximumQuote: (unit / 10n).toString(),
    maximumTickDeviation: "100", oracleSeconds: "60", liquidityBps: String(liquidityBps) };
  const configurationAbi = [
    { path: ["minimumQuote"], type: "uint128" }, { path: ["maximumQuote"], type: "uint128" },
    { path: ["maximumTickDeviation"], type: "uint16" }, { path: ["oracleSeconds"], type: "uint32" },
    { path: ["liquidityBps"], type: "uint16" },
  ];
  const sourceDescriptor = {
    format: "programmable.classic.source-package.v0.1", name, version: "1.0.0",
    author: "0x9e1339eaed0eff31eda7d714a341eb09a7e4513e", rewardWallet: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
    familySalt: keccak256(toHex(`programmable.foundation.${slug}.v1`)), source: { files: sourceFiles },
    components: [{ id: "module", runtime: "programmable.module-foundation.solidity@1", sourcePath: `${sourceRoot}/${moduleName}.sol`, entrypoint: moduleName },
      { id: "factory", runtime: "programmable.module-foundation.solidity@1", sourcePath: `${sourceRoot}/${factoryName}.sol`, entrypoint: factoryName }],
    configuration: { type: "record", fields: {
      minimumQuote: uint(128, "1", ((1n << 127n) - 1n).toString(), "Minimum batch", "Raw quote units. Fees wait until this amount is available.", "quote.raw"),
      maximumQuote: uint(128, "1", ((1n << 127n) - 1n).toString(), "Maximum batch", "Raw quote units. Must be at least the minimum batch.", "quote.raw"),
      maximumTickDeviation: uint(16, "10", "2000", "Price deviation limit", "Maximum distance from the observed time-weighted average, in Uniswap ticks.", "uniswap.ticks"),
      oracleSeconds: uint(32, "30", "300", "Price observation window", "Processing waits for this observation window to mature.", "seconds"),
      liquidityBps: uint(16, slug === "tax-liquidity-burn" ? "1" : String(liquidityBps), slug === "tax-liquidity-burn" ? "9999" : String(liquidityBps),
        "Liquidity share", "The rest buys and burns coin tokens. Fixed for the dedicated modules.", "programmable.percent-bps"),
    }, required: Object.keys(defaults) }, ports: { inputs: {}, outputs: {} },
    constraints: [{ id: "batch-order", message: "Maximum batch must be at least the minimum batch.",
      left: { ref: { instance: "$self", path: ["minimumQuote"] } }, operator: "lte",
      right: { ref: { instance: "$self", path: ["maximumQuote"] } } }], documentation,
    management: { summary,
      reads: [["quote-spent", "quoteProcessed", "Quote spent"], ["tokens-burned", "tokensBurned", "Tokens burned"],
        ["locked-liquidity", "liquidityAdded", "Locked liquidity"], ["completed-batches", "processCount", "Completed batches"]]
        .map(([id, entrypoint, label]) => ({ id, label, component: "module", entrypoint, description: `Cumulative ${label.toLowerCase()} for this module instance.` })),
      actions: [{ id: "process", label: "Retry processing", component: "module", entrypoint: "process", role: "public",
        description: "Permissionless retry through the host with the same price and budget checks. Ordinary swaps process automatically.", inputs: { type: "record", fields: {}, required: [] } }],
    }, requiresHost: requirements, extensions: { "programmable.module-studio@1": { category: liquidityBps === 0 ? "supply" : "liquidity" }, [FOUNDATION_PACKAGE_EXTENSION_V1]: {
      hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1, descriptor, descriptorHash: hashFoundationModuleDescriptorV1(descriptor),
      configurationCodec: FOUNDATION_CONFIGURATION_CODEC_V1, configurationAbi, defaults,
      actions: [{ id: "process", selector: toFunctionSelector("process()"), configurationAbi: [] }],
    } },
  } as OpenSourcePackage;
  const requestDigest = `0x${createHash("sha256").update(JSON.stringify(sourceDescriptor)).digest("hex")}` as const;
  const manifest = createFoundationModuleManifestV1(sourceDescriptor, requestDigest);
  const encoded = encodeFoundationConfigurationV1(manifest, defaults);
  assert.equal(encoded.configuration, encodeAbiParameters([{ type: "uint128" }, { type: "uint128" }, { type: "uint16" }, { type: "uint32" }, { type: "uint16" }],
    [BigInt(defaults.minimumQuote), BigInt(defaults.maximumQuote), 100, 60, liquidityBps]));
  assert.equal(encodeFoundationActionV1(manifest, "process", {}).data, toFunctionSelector("process()"));
  await writeFile(path.resolve(output, `${slug}.source-manifest.json`), JSON.stringify(manifest, null, 2) + "\n");
  packages.push({ name, slug, packageId: manifest.packageId, descriptorHash: hashFoundationModuleDescriptorV1(descriptor),
    configuration: encoded.configuration, quoteDecimals: decimals, activeCatalog: false });
}
await writeFile(path.resolve(output, "preparation.json"), JSON.stringify({ status: "source-only-not-deployed", packages,
  adapter: STAGED_TAX_AUTOMATION_HOST_V1, currentHostRejectsAutomation: true, broadcast: false }, null, 2) + "\n");
console.log(JSON.stringify({ prepared: packages.length, quoteDecimals: decimals, status: "source-only-not-deployed", output: path.resolve(output) }));
