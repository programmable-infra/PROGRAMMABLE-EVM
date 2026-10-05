import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { verifyFoundationOwnerRuntimeV1 } from "@/lib/module-foundation/owner-runtime";
import type { FoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-publication";
import { run as stageTarget, publishCatalogBatch } from "./main";

/** One job, resumable per-chain journals, one atomic catalog compare-and-swap. */
export async function run(args: string[], repositoryRoot: string) {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--job", "--wallet-file", "--storage-file", "--output"].includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw Error("Invalid shared publication arguments.");
    flags.set(args[i], path.resolve(args[i + 1]));
  }
  if (flags.size !== 4) throw Error("A shared publication needs job, wallet, storage and output files.");
  const job = JSON.parse(await readFile(flags.get("--job")!, "utf8"));
  if (job.schemaVersion !== "programmable.shared-module-job.v1" || !Array.isArray(job.targets)
    || job.targets.length !== 2 || job.targets.map((t: { chainId: number }) => t.chainId).sort((a: number, b: number) => a - b).join() !== "1,4663") throw Error("Both Ethereum and Robinhood targets are required.");
  const output = flags.get("--output")!;
  await mkdir(output, { recursive: true, mode: 0o700 });
  const publications: FoundationOwnerPublicationV1[] = [];
  for (const target of job.targets) {
    const targetDirectory = path.join(output, String(target.chainId));
    await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    const targetJob = path.join(targetDirectory, "job.json");
    const encoded = JSON.stringify({ ...target, sourceFile: job.sourceFile, publish: false });
    try { await writeFile(targetJob, encoded, { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(targetJob, "utf8") !== encoded) throw Error("The resumed publication target changed."); }
    await stageTarget(["--job", targetJob, "--wallet-file", flags.get("--wallet-file")!, "--storage-file", flags.get("--storage-file")!, "--output", targetDirectory], repositoryRoot);
    const publication = JSON.parse(await readFile(path.join(targetDirectory, "publication.json"), "utf8")) as FoundationOwnerPublicationV1;
    const rpc = target.rpcEnvironment ? process.env[target.rpcEnvironment] : foundationChainProfile(target.chainId).publicRpcUrls[0];
    if (!rpc) throw Error("The target RPC is missing.");
    await verifyFoundationOwnerRuntimeV1(publication, createPublicClient({ chain: foundationChainProfile(target.chainId).chain, transport: http(rpc, { retryCount: 0, timeout: 30_000 }) }));
    publications.push(publication);
  }
  if (job.activate !== true) return;
  const storage = JSON.parse(await readFile(flags.get("--storage-file")!, "utf8"));
  await publishCatalogBatch(publications, storage.token, (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }));
}
