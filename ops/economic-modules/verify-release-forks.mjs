#!/usr/bin/env node
// Reads mainnet state; all state-changing execution happens inside Forge's local forks.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { keccak256 } from "viem";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const release = path.resolve(process.argv[2] ?? "");
const output = path.resolve(process.argv[3] ?? "");
const candidate = process.argv[4] === "--candidate";
if (process.argv[4] && !candidate) throw new Error("Unknown verification mode");
if (!process.argv[2] || !process.argv[3] || release === output) {
  throw new Error("Usage: verify-release-forks.mjs RELEASE_DIRECTORY NEW_RESULT_DIRECTORY");
}
const families = ["buyback-burn", "dip-buyback", "lp-rewards", "full-range-lp", "buyer-rewards", "nth-buy-pot",
  "king-of-the-hill", "hot-potato", "plague", "reactive-pair", "entangled"];
const networks = [
  { id: 1, rpc: "FOUNDATION_ETHEREUM_RPC_URL", secondary: "FOUNDATION_ETHEREUM_SECONDARY_RPC_URL", block: "FOUNDATION_ETHEREUM_FORK_BLOCK" },
  { id: 4663, rpc: "FOUNDATION_RPC_URL", secondary: "FOUNDATION_SECONDARY_RPC_URL", block: "FOUNDATION_FORK_BLOCK" },
];
const urls = networks.flatMap(n => [process.env[n.rpc], process.env[n.secondary]]);
if (urls.some(url => !url || !/^https?:\/\//.test(url))) throw new Error("Both independent RPCs are required for each chain");
for (const n of networks) {
  if (new URL(process.env[n.rpc]).host === new URL(process.env[n.secondary]).host) throw new Error("Independent provider hosts required");
}
await fs.mkdir(output, { recursive: false });
if (candidate) {
  try {
    const built = execFileSync("forge", ["build", "--root", "contracts", "--no-lint"], {
      cwd: repo, env: { ...process.env, FOUNDRY_PROFILE: "module-foundation" }, encoding: "utf8", timeout: 600000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await fs.writeFile(path.join(output, "candidate-build.log"), built);
  } catch {
    throw new Error("Candidate compilation failed");
  }
}
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");
const redact = text => urls.reduce((value, url) => value.split(url).join("[RPC REDACTED]"), text)
  .replace(/https?:\/\/[^\s"<>]+/g, "[URL REDACTED]");
async function rpc(url, method, params) {
  // Deliberately no send/submit methods in this harness.
  if (!["eth_chainId", "eth_getBlockByNumber", "eth_getCode"].includes(method)) throw new Error("Read-only RPC method required");
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok || body.error || body.result == null) throw new Error(`${method} failed on ${new URL(url).host}`);
  return body.result;
}
const manifest = { schemaVersion: "programmable.economic-release-fork-input.v1", createdAt: new Date().toISOString(), chains: {} };
const env = { ...process.env, FOUNDRY_PROFILE: "module-foundation" };
for (const n of networks) {
  const endpoints = [process.env[n.rpc], process.env[n.secondary]];
  const views = await Promise.all(endpoints.map(async url => ({
    chainId: Number(BigInt(await rpc(url, "eth_chainId", []))),
    finalized: await rpc(url, "eth_getBlockByNumber", ["finalized", false]),
  })));
  if (views.some(view => view.chainId !== n.id)) throw new Error(`Chain mismatch for ${n.id}`);
  const number = Math.min(...views.map(view => Number(BigInt(view.finalized.number))));
  const tag = "0x" + number.toString(16);
  const blocks = await Promise.all(endpoints.map(url => rpc(url, "eth_getBlockByNumber", [tag, false])));
  if (blocks[0].hash !== blocks[1].hash) throw new Error(`Finalized block mismatch on ${n.id}`);
  const chain = { chainId: n.id, blockNumber: number, blockHash: blocks[0].hash,
    providers: endpoints.map(url => new URL(url).host) };
  const binding = JSON.parse(await fs.readFile(path.join(release, `host-binding-${n.id}.json`), "utf8"));
  const hostCodes = await Promise.all(endpoints.map(url => rpc(url, "eth_getCode", [binding.factory.address, tag])));
  if (hostCodes.some(code => keccak256(code) !== binding.factory.runtimeCodeHash)) throw new Error(`Host runtime mismatch on ${n.id}`);
  chain.hostFactory = binding.factory.address;
  chain.hostFactoryCodeHash = binding.factory.runtimeCodeHash;
  for (const [kind, family] of families.entries()) {
    const publication = JSON.parse(await fs.readFile(path.join(release, "runs", family, String(n.id), "publication.json"), "utf8"));
    const r = publication.release;
    if (r.chainId !== n.id) throw new Error(`Publication chain mismatch: ${family}`);
    const codes = await Promise.all(endpoints.map(url => rpc(url, "eth_getCode", [r.factory, tag])));
    if (codes.some(code => keccak256(code) !== r.factoryCodeHash)) throw new Error(`Factory code mismatch: ${n.id}/${family}`);
    chain[`m${kind}`] = { family, factory: r.factory, factoryCodeHash: r.factoryCodeHash,
      moduleCodeHash: r.moduleCodeHash, descriptorHash: r.descriptorHash, publicationDigest: publication.publicationDigest,
      localCandidate: false };
    if (candidate && kind < 4) {
      const names = ["BuybackBurnFactoryV1", "DipBuybackFactoryV1", "LPRewardsFactoryV1", "FullRangeLPFactoryV1"];
      const artifact = JSON.parse(await fs.readFile(path.join(repo, "contracts/out/module-foundation/EconomicModuleFactoriesV1.sol", names[kind] + ".json"), "utf8"));
      const module = JSON.parse(await fs.readFile(path.join(repo, "contracts/out/module-foundation/FeeStrategyV1.sol/FeeStrategyV1.json"), "utf8"));
      Object.assign(chain[`m${kind}`], { localCandidate: true, publishedFactoryCodeHash: r.factoryCodeHash,
        publishedModuleCodeHash: r.moduleCodeHash, factoryCodeHash: keccak256(artifact.deployedBytecode.object),
        moduleCodeHash: keccak256(module.deployedBytecode.object) });
    }
  }
  manifest.chains[`c${n.id}`] = chain;
  env[n.block] = String(number);
  console.log(`Verified 11 deployed factories on chain ${n.id} at finalized block ${number}`);
}
await writeJson(path.join(output, "release-input.json"), manifest);
// Forge is permitted to read public test inputs from contracts/out only.
const forgeInput = path.join(repo, "contracts/out", `economic-release-fork-input-${Date.now()}.json`);
await fs.mkdir(path.dirname(forgeInput), { recursive: true });
await writeJson(forgeInput, manifest);
env.ECONOMIC_RELEASE_MANIFEST = forgeInput;
env.ECONOMIC_HOST_MANIFEST = forgeInput;
const args = ["test", "--root", "contracts", "--match-contract",
  "^(EconomicModules(Robinhood|Ethereum)ForkTest|FoundationEthereumStampV1Test|EconomicRulesV1Test)$", "--json"];
await fs.writeFile(path.join(output, "source-changes.patch"), execFileSync("git", ["diff", "--", "contracts", "ops/economic-modules"], { cwd: repo }));
await fs.copyFile(path.join(repo, "contracts/test/module-foundation/EconomicReleaseFixtureV1.sol"), path.join(output, "EconomicReleaseFixtureV1.sol"));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const result = await new Promise((resolve, reject) => {
  const child = spawn("forge", args, { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", code => resolve({ code, stdout: redact(stdout), stderr: redact(stderr) }));
});
await fs.writeFile(path.join(output, "forge-stdout.json"), result.stdout);
await fs.writeFile(path.join(output, "forge-stderr.log"), result.stderr);
await fs.rm(forgeInput);
let suites;
try { suites = JSON.parse(result.stdout); } catch { throw new Error("Forge did not return test JSON; inspect sanitized logs"); }
const report = { schemaVersion: "programmable.economic-release-fork-result.v1", completedAt: new Date().toISOString(),
  sourceCommit, command: ["forge", ...args], simulationOnly: true, mainnetTransactionsSent: 0,
  moduleMode: candidate ? "Local candidate fee factories (four per chain); other seven use published factories" : "All published factories",
  canonicalEthereumPermit: "Exact EIP-1271 permit stubbed on the local fork; live authorization is not proven by this test",
  hostDeployment: "Actual Robinhood V2 factory; Ethereum behavior uses source-built V3, canonical stamp tests use actual router and graph factory",
  networks: Object.values(manifest.chains).map(c => ({ chainId: c.chainId, blockNumber: c.blockNumber, blockHash: c.blockHash })),
  passed: 0, failed: 0, skipped: 0, suites: [] };
for (const [name, suite] of Object.entries(suites)) {
  const tests = Object.entries(suite.test_results).map(([name, result]) => ({ name, status: result.status, reason: result.reason ?? null }));
  for (const test of tests) {
    if (test.status === "Success") report.passed++;
    else if (test.status === "Skipped") report.skipped++;
    else report.failed++;
  }
  report.suites.push({ name, tests });
}
report.success = result.code === 0 && report.failed === 0 && report.skipped === 0 && report.passed >= 70;
await writeJson(path.join(output, "result.json"), report);
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, skipped: report.skipped, success: report.success, output }));
if (!report.success) process.exitCode = 1;
