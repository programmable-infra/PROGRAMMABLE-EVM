import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createPublicClient } from "viem";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { nativeCanonicalJson } from "@/lib/module-mode/native-catalog";
import { discoverEconomicTargets, type DiscoveryPosition, type EconomicTarget } from "./discovery";
import { validateExecutionConfig } from "./run.mjs";
import { economicHttp } from "./rpc.mjs";

const execute = promisify(execFile);

export async function writeDurable(file: string, value: unknown) {
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
export async function run(args: string[], root: string, options: { signal?: AbortSignal } = {}) {
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
  const clients = urls.map(url => createPublicClient({ chain, transport: economicHttp(url.href, options) })) as unknown as Parameters<typeof discoverEconomicTargets>[0]["clients"];
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
    if (head < BigInt(state.position.block)) throw Error("Confirmed providers are behind the discovery checkpoint.");
    let processed = 0, pages = 0;
    const deadline = Date.now() + 90_000;
    const caughtUp = () => BigInt(state.position.block) === head && state.position.logIndex === Number.MAX_SAFE_INTEGER;
    // Every page remains bounded and independently verified. A later failure cannot erase earlier progress.
    while (!caughtUp() && pages < 32 && Date.now() < deadline) {
      options.signal?.throwIfAborted();
      const position = BigInt(state.position.block);
      const page = await discoverEconomicTargets({ clients, binding, admissions: config.discovery.admissions, position: state.position,
        toBlock: position + 999n < head ? position + 999n : head, maxLaunches: 1 });
      if (BigInt(page.position.block) < position || (BigInt(page.position.block) === position && page.position.logIndex <= state.position.logIndex)) {
        throw Error("Discovery did not advance its checkpoint.");
      }
      const targets = new Map(state.targets.map(target => [`${target.host.toLowerCase()}:${target.index}`, target]));
      for (const target of page.targets) {
        const key = `${target.host.toLowerCase()}:${target.index}`, previous = targets.get(key);
        if (previous && nativeCanonicalJson(previous) !== nativeCanonicalJson(target)) throw Error("An immutable registered target changed.");
        targets.set(key, target);
      }
      state = { sourceDigest, position: page.position, targets: [...targets.values()] };
      validateExecutionConfig({ ...execution, targets: state.targets });
      processed += page.processed;
      pages++;
      await writeDurable(registry, state);
    }
    const passConfig = validateExecutionConfig({ ...execution, targets: state.targets });
    options.signal?.throwIfAborted();
    // Preview advances its own discovery cursor without changing the live registry or nonce journal.
    await writeDurable(registry, state);
    const executionFile = path.join(directory, preview ? "preview-execution.json" : "execution.json");
    await writeDurable(executionFile, passConfig);
    const result = await execute(process.execPath, [path.join(root, "ops/economic-modules/run.mjs"), executionFile,
      path.join(directory, preview ? "preview-execution-journal.json" : "execution-journal.json"), preview ? "--preview-state" : "--broadcast"], { encoding: "utf8", timeout: 240_000, maxBuffer: 65_536 });
    const status = { checkedAt: new Date().toISOString(), processedLaunches: processed, targets: state.targets.length,
      discoveryBlock: state.position.block, confirmedHead: head.toString(), lagBlocks: (head - BigInt(state.position.block)).toString(),
      caughtUp: caughtUp(), pages, execution: JSON.parse(result.stdout) };
    await writeDurable(path.join(directory, preview ? "preview-health.json" : "health.json"), status);
    console.log(JSON.stringify(status));
    return status;
  } finally { await rm(lock, { recursive: true }); }
}
