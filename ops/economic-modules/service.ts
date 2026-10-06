import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { nativeCanonicalJson } from "@/lib/module-mode/native-catalog";
import { discoverEconomicTargets, type DiscoveryPosition, type EconomicTarget } from "./discovery";
import { validateExecutionConfig } from "./run.mjs";

async function writeDurable(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try { await handle.writeFile(JSON.stringify(value) + "\n"); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, file);
  const directory = await open(path.dirname(file), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

/** One invocation per timer tick. The directory is chain/account-specific and
 * persistent; local locks forbid overlapping passes. Credentials stay in env. */
export async function run(args: string[], root: string) {
  const [file, directoryArg, flag] = args;
  if (!file || !directoryArg || (flag && flag !== "--broadcast")) throw Error("Use CONFIG STATE_DIRECTORY [--broadcast].");
  const bytes = await readFile(file);
  if (bytes.length > 131_072) throw Error("Execution service configuration is too large.");
  const config = JSON.parse(bytes.toString("utf8"));
  const execution = validateExecutionConfig({ ...config.execution, targets: [] });
  const secondary = execution.secondaryRpcEnv;
  if (!secondary || !/^[A-Z][A-Z0-9_]+$/.test(secondary) || execution.confirmations < 64) throw Error("Independent confirmed discovery is required.");
  const sourceDigest = createHash("sha256").update(nativeCanonicalJson(config.discovery)).digest("hex");
  const binding = { ...config.discovery.binding, startBlock: BigInt(config.discovery.binding.startBlock),
    ...(config.discovery.binding.ethereumGraph ? { ethereumGraph: { ...config.discovery.binding.ethereumGraph,
      startBlock: BigInt(config.discovery.binding.ethereumGraph.startBlock) } } : {}) };
  if ((binding.chainId ?? 4663) !== execution.chainId) throw Error("Discovery and execution chains differ.");
  const from = BigInt(config.discovery.startBlock);
  if (from < binding.startBlock) throw Error("Discovery starts before the admitted host.");
  const urls = [execution.rpcEnv, secondary].map(name => new URL(process.env[name] ?? ""));
  if (urls.some(url => url.protocol !== "https:" || url.username || url.password) || urls[0].hostname === urls[1].hostname) throw Error("Use independent HTTPS providers.");
  const chain = foundationChainProfile(execution.chainId).chain;
  const clients = urls.map(url => createPublicClient({ chain, transport: http(url.href, { retryCount: 0, timeout: 15_000 }) })) as unknown as Parameters<typeof discoverEconomicTargets>[0]["clients"];
  const directory = path.resolve(directoryArg), preview = flag !== "--broadcast";
  const registry = path.join(directory, preview ? "preview-registry.json" : "registry.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, "service.lock");
  await mkdir(lock);
  try {
    let state: { sourceDigest: string; position: DiscoveryPosition; targets: EconomicTarget[] };
    try { state = JSON.parse(await readFile(registry, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = { sourceDigest, position: { block: from.toString(), logIndex: -1 }, targets: [] };
    }
    if (state.sourceDigest !== sourceDigest) throw Error("Discovery configuration changed; preserve the old registry and prepare its migration.");
    const heads = await Promise.all(clients.map(client => client.getBlockNumber({ cacheTime: 0 })));
    const head = heads.reduce((a, b) => a < b ? a : b) - BigInt(execution.confirmations);
    const position = BigInt(state.position.block);
    let processed = 0;
    if (head >= position && (head > position || state.position.logIndex !== Number.MAX_SAFE_INTEGER)) {
      const page = await discoverEconomicTargets({ clients, binding, admissions: config.discovery.admissions, position: state.position,
        toBlock: position + 999n < head ? position + 999n : head });
      const targets = new Map(state.targets.map(target => [`${target.host.toLowerCase()}:${target.index}`, target]));
      for (const target of page.targets) {
        const key = `${target.host.toLowerCase()}:${target.index}`, previous = targets.get(key);
        if (previous && nativeCanonicalJson(previous) !== nativeCanonicalJson(target)) throw Error("An immutable registered target changed.");
        targets.set(key, target);
      }
      state = { sourceDigest, position: page.position, targets: [...targets.values()] };
      processed = page.processed;
    }
    const passConfig = validateExecutionConfig({ ...execution, targets: state.targets });
    // Preview advances its own discovery cursor without changing the live registry or nonce journal.
    await writeDurable(registry, state);
    const executionFile = path.join(directory, preview ? "preview-execution.json" : "execution.json");
    await writeDurable(executionFile, passConfig);
    const result = execFileSync(process.execPath, [path.join(root, "ops/economic-modules/run.mjs"), executionFile,
      path.join(directory, preview ? "preview-execution-journal.json" : "execution-journal.json"), preview ? "--preview-state" : "--broadcast"], { encoding: "utf8", timeout: 240_000, maxBuffer: 65_536 });
    const status = { checkedAt: new Date().toISOString(), processedLaunches: processed, targets: state.targets.length,
      discoveryBlock: state.position.block, execution: JSON.parse(result) };
    await writeDurable(path.join(directory, preview ? "preview-health.json" : "health.json"), status);
    console.log(JSON.stringify(status));
    return status;
  } finally { await rm(lock, { recursive: true }); }
}
