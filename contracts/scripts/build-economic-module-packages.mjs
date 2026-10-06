import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256, stringToHex, toFunctionSelector } from "viem";
import { validateModuleSubmissionRequest } from "../../packages/classic-modules/src/open-transport.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const destination = process.argv[2];
if (!destination) throw new Error("Pass an output directory. This command packages sources only; it does not publish.");
const base = "contracts/src/module-foundation/modules/economics";
const hash = value => keccak256(stringToHex(value));
const uint = (bits, min, max, label, unit) => ({ type: "uint", bits, min: String(min), max: String(max), label, ...(unit ? { unit } : {}) });
const fixed = (bits, value) => ({ ...uint(bits, value, value, "Fixed setting"), binding: { mode: "fixed", value: String(value) } });
const amount = label => uint(128, 1, (1n << 127n) - 1n, label, "programmable.quote-amount");
const pct = (min, max, label) => uint(16, min, max, label, "programmable.percent-bps");
const ref = name => ({ ref: { instance: "$self", path: [name] } });
const lte = (id, left, right, message) => ({ id, left: ref(left), operator: "lte", right: ref(right), message });

const definitions = [];
for (const [id, name, factory, summary] of [
  ["buyback-burn", "Buyback and burn", "BuybackBurn", "Your assigned fees buy this token from its pool and burn the purchased tokens. Purchases use a time-weighted price limit, a maximum batch and a waiting period."],
  ["dip-buyback", "Dip buyback", "DipBuyback", "Your assigned fees buy and burn this token after its price falls below its recent time-weighted price by your chosen percentage."],
  ["lp-rewards", "LP rewards", "LPRewards", "Your assigned fees go to the liquidity currently active in this pool. This rewards existing liquidity providers; it does not create a new liquidity position."],
  ["full-range-lp", "Full-range liquidity", "FullRangeLP", "Your assigned fees buy tokens and add both assets as permanently locked liquidity across the full price range. Unused amounts carry into the next batch."],
]) {
  const fields = { minimumBudget: amount("Minimum fee balance"), maximumBatch: amount("Maximum amount per batch"),
    intervalSeconds: uint(32, 30, 604800, "Time between batches (seconds)", "seconds"),
    priceWindowSeconds: id === "lp-rewards" ? fixed(32, 300) : uint(32, 300, 600, "Price reference period (seconds)", "seconds"),
    slippageBps: id === "lp-rewards" ? fixed(16, 500) : pct(1, 1000, "Maximum slippage (%)"),
    dipBps: id === "dip-buyback" ? pct(1, 5000, "Required price drop (%)") : fixed(16, 0) };
  definitions.push({ id, name, factory, contract: "FeeStrategy", phases: 7, resources: 1, beforeGas: 100000, afterGas: 40000, actionGas: 2000000,
    fields, defaults: { intervalSeconds: "300", priceWindowSeconds: "300", slippageBps: "500", dipBps: id === "dip-buyback" ? "500" : "0" },
    constraints: [lte("batch-size", "minimumBudget", "maximumBatch", "The maximum batch must cover the minimum fee balance.")],
    summary: `${summary} Automatic execution needs a running keeper. Existing trading rules can postpone a purchase.`,
    actions: [{ id: "execute", label: "Execute ready batch", component: "module", entrypoint: "onAction", role: "public", description: "Execute one ready batch within the immutable budget and price limits.", inputs: { type: "record", fields: {}, required: [] } }],
    actionAbi: [{ id: "execute", selector: toFunctionSelector("execute()"), configurationAbi: [] }],
    reads: [{ id: "spent", label: "Quote fees used", component: "module", entrypoint: "totalQuoteUsed", description: "Total quote fees used by this strategy in raw quote units." }], category: id.endsWith("lp") || id === "lp-rewards" ? "liquidity" : "supply" });
}
for (const [id, name, factory, summary] of [
  ["buyer-rewards", "Buyer rewards", "BuyerRewards", "Qualifying buyers earn rewards in the quote token. Each reward is capped by fees already assigned to this module."],
  ["nth-buy-pot", "Nth-buy pot", "NthBuyPot", "Every Nth qualifying buy wins the accumulated fee pot. At most one buy qualifies per block. The counter is public and predictable."],
  ["king-of-the-hill", "King of the Hill", "KingOfTheHill", "A buy above the current challenge amount takes the crown and starts earning assigned fees. The challenge amount falls over time. A sale through the supported router gives up the crown. Other transfers are not tracked."],
]) {
  const fields = { minimumBuy: amount("Minimum qualifying buy"), rewardBps: id === "buyer-rewards" ? pct(1, 1000, "Reward as a share of the buy (%)") : fixed(16, 0),
    everyN: id === "nth-buy-pot" ? uint(32, 2, 1000000, "Winning buy number") : fixed(32, 0),
    crownDecaySeconds: id === "king-of-the-hill" ? uint(32, 60, 2592000, "Time until the challenge reaches its minimum (seconds)", "seconds") : fixed(32, 0) };
  definitions.push({ id, name, factory, contract: "BuyerRewards", phases: 6, resources: 1, beforeGas: 0, afterGas: 240000, actionGas: 1500000,
    fields, defaults: { rewardBps: id === "buyer-rewards" ? "100" : "0", everyN: id === "nth-buy-pot" ? "10" : "0", crownDecaySeconds: id === "king-of-the-hill" ? "3600" : "0" }, constraints: [],
    summary: `${summary} Rewards are paid to the recorded buyer. A keeper can pay them automatically; anyone can also trigger payment. Internal module buys do not participate.`,
    actions: [{ id: "pay", label: "Pay recorded rewards", component: "module", entrypoint: "onAction", role: "public", description: "Pay existing rewards to their recorded beneficiaries. The caller cannot redirect a payment.", inputs: { type: "record", fields: { beneficiaries: { type: "array", minItems: 1, maxItems: 16, items: { type: "address" }, label: "Beneficiary addresses" } }, required: ["beneficiaries"] } }],
    actionAbi: [{ id: "pay", selector: toFunctionSelector("pay(address[])"), configurationAbi: [{ path: ["beneficiaries"], type: "address[]" }] }],
    reads: [{ id: "paid", label: "Rewards paid", component: "module", entrypoint: "totalPaid", description: "Total rewards already paid in raw quote units." }], category: "fees" });
}
for (const [id, name, factory, summary] of [
  ["hot-potato", "Hot potato", "HotPotato", "The last qualifying buyer must wait for another qualifying buyer or for the timeout before selling through this pool. The timeout is always at most one hour. Ordinary transfers and other pools are not restricted."],
  ["plague", "Plague", "Plague", "A wallet must already hold your chosen minimum token amount before buying through this pool. The creator can make the first buys and send tokens to new holders. Selling stays available."],
]) {
  const fields = { minimum: id === "hot-potato" ? amount("Minimum qualifying buy") : uint(128, 1, 1000000000n * 10n ** 18n, "Tokens required before buying", "programmable.token-amount"),
    pauseSeconds: id === "hot-potato" ? uint(32, 1, 3600, "Maximum sell pause (seconds)", "seconds") : fixed(32, 0) };
  definitions.push({ id, name, factory, contract: "PoolGames", phases: 3, resources: 0, beforeGas: 110000, afterGas: 110000, actionGas: 0,
    fields, defaults: id === "hot-potato" ? { pauseSeconds: "60" } : { minimum: "1000000000000000000", pauseSeconds: "0" }, constraints: [], summary,
    actions: [], actionAbi: [], reads: [], category: "trading" });
}
for (const [id, name, factory, summary] of [
  ["reactive-pair", "Reactive pair", "ReactivePair", "Your maximum tokens per buy follows another pool's price relative to its price at launch, within your chosen limits. The reference must use the same quote token on this chain. Sells remain available."],
  ["entangled", "Entangled", "Entangled", "Buys open when the reference pool's price rises by your chosen percentage from its price at launch. The first successful qualifying buy permanently opens buying. Omit your first buy at launch while the gate is closed. Sells remain available."],
]) {
  const fields = { referenceHost: { type: "address", label: "Reference pool hook address", help: "Use an existing compatible pool on this chain with the same quote token." },
    baseCapBps: id === "reactive-pair" ? pct(1, 10000, "Starting buy cap (% of supply)") : fixed(16, 0),
    minimumCapBps: id === "reactive-pair" ? pct(1, 10000, "Minimum buy cap (% of supply)") : fixed(16, 0),
    maximumCapBps: id === "reactive-pair" ? pct(1, 10000, "Maximum buy cap (% of supply)") : fixed(16, 0),
    unlockRiseBps: id === "entangled" ? pct(1, 65535, "Reference price increase to open buys (%)") : fixed(16, 0) };
  definitions.push({ id, name, factory, contract: "LinkedPool", phases: 3, resources: 0, beforeGas: 100000, afterGas: 100000, actionGas: 0,
    fields, defaults: id === "reactive-pair" ? { baseCapBps: "100", minimumCapBps: "10", maximumCapBps: "500", unlockRiseBps: "0" }
      : { baseCapBps: "0", minimumCapBps: "0", maximumCapBps: "0", unlockRiseBps: "1000" },
    constraints: id === "reactive-pair" ? [lte("minimum-cap", "minimumCapBps", "baseCapBps", "The starting cap must reach the minimum."), lte("maximum-cap", "baseCapBps", "maximumCapBps", "The maximum cap must reach the starting cap.")] : [],
    summary, actions: [], actionAbi: [], reads: [], category: "trading" });
}

// Include the exact dependency source bytes. Consumers need no mutable upstream imports.
const remappings = (await readFile(resolve(root, "contracts/remappings.txt"), "utf8")).trim().split("\n").map(line => line.split("=")).sort((a,b) => b[0].length-a[0].length);
const sources = new Map();
async function collect(file) {
  if (sources.has(file)) return;
  const bytes = await readFile(resolve(root, file)); sources.set(file, bytes);
  for (const match of bytes.toString().matchAll(/import\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']\s*;/g)) {
    const specifier = match[1];
    let target;
    if (specifier.startsWith(".")) target = posix.normalize(posix.join(posix.dirname(file), specifier));
    else { const mapping = remappings.find(([prefix]) => specifier.startsWith(prefix)); if (!mapping) throw new Error(`Unresolved import: ${specifier}`); target = `contracts/${mapping[1]}${specifier.slice(mapping[0].length)}`; }
    if (!target.startsWith("contracts/")) throw new Error("Import escaped contract source root");
    await collect(target);
  }
}
await collect(`${base}/EconomicModuleFactoriesV1.sol`);
sources.set("contracts/remappings.txt", await readFile(resolve(root, "contracts/remappings.txt")));
sources.set("README.md", await readFile(resolve(root, "contracts/spec/module-foundation/economic-modules-v1.md")));
const files = [...sources].map(([path, bytes]) => ({ path, sha256: createHash("sha256").update(bytes).digest("hex"), encoding: "base64", bytes: bytes.toString("base64") }));
const results = [];
for (const d of definitions) {
  const moduleId = hash(`programmable.foundation.${d.id}.v1`);
  const descriptor = { moduleId, abiVersion: 1, phases: d.phases, resources: d.resources, beforeGas: d.beforeGas, afterGas: d.afterGas, actionGas: d.actionGas, failOpenAfter: false, exclusiveGroup: moduleId };
  const descriptorHash = keccak256(encodeAbiParameters([{ type: "tuple", components: Object.entries(descriptor).map(([name]) => ({ name, type: name === "moduleId" || name === "exclusiveGroup" ? "bytes32" : name === "failOpenAfter" ? "bool" : name.endsWith("Gas") ? "uint32" : name === "abiVersion" ? "uint16" : "uint8" })) }], [descriptor]));
  const checked = validateModuleSubmissionRequest({ format: "programmable.modules.submission.v0.1", files,
    descriptor: { format: "programmable.classic.source-package.v0.1", name: d.name, version: "1.0.0",
      author: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da", rewardWallet: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da", familySalt: hash(`programmable.foundation.${d.id}`),
      source: { files: files.map(({ path, sha256 }) => ({ path, sha256 })) },
      components: [{ id: "module", runtime: "programmable.module-foundation.solidity@1", sourcePath: `${base}/${d.contract}V1.sol`, entrypoint: `${d.contract}V1` },
        { id: "factory", runtime: "programmable.module-foundation.solidity@1", sourcePath: `${base}/EconomicModuleFactoriesV1.sol`, entrypoint: `${d.factory}FactoryV1` }],
      configuration: { type: "record", fields: d.fields, required: Object.keys(d.fields) }, ports: { inputs: {}, outputs: {} }, constraints: d.constraints,
      requiresHost: ["programmable.module-foundation.host@1", "programmable.foundation-abi@1",
        ...(d.phases & 1 ? ["programmable.module-foundation.before-swap@1"] : []), ...(d.phases & 2 ? ["programmable.module-foundation.after-swap@1"] : []),
        ...(d.phases & 4 ? ["programmable.module-foundation.action@1"] : []), ...(d.resources ? ["programmable.module-foundation.own-quote-budget@1"] : [])],
      documentation: "README.md", management: { summary: d.summary, reads: d.reads, actions: d.actions },
      extensions: { "programmable.module-studio@1": { category: d.category }, "programmable.module-foundation@1": {
        hostAdapterId: "programmable.module-foundation.host@1", descriptor, descriptorHash, configurationCodec: "programmable.foundation-abi@1",
        configurationAbi: Object.entries(d.fields).map(([name, field]) => ({ path: [name], type: field.type === "uint" ? `uint${field.bits}` : "address" })), defaults: d.defaults, actions: d.actionAbi } } } });
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  const output = resolve(destination, d.id); await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "source-package.json"), JSON.stringify(checked.request, null, 2) + "\n");
  const candidate = { id: d.id, packageId: checked.packageId, familyId: checked.familyId, requestDigest: checked.requestDigest, descriptorHash, requiredChainIds: [1,4663], available: false };
  await writeFile(resolve(output, "candidate.json"), JSON.stringify(candidate, null, 2) + "\n"); results.push(candidate);
}
await writeFile(resolve(destination, "candidates.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ count: results.length, sourceFiles: files.length, requiredChainIds: [1,4663], available: false }));
