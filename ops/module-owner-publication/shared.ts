import publishers from "@/config/module-foundation/owner-publishers.json";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { verifyFoundationOwnerRuntimeV1 } from "@/lib/module-foundation/owner-runtime";
import { verifyFoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-verification";
import type { FoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-publication";
import { run as stageTarget, publishCatalogBatch } from "./main";

/** The signed owner catalog admits child modules; the protocol release binds the host. */
export async function verifySharedActivation(publications: FoundationOwnerPublicationV1[],
  allowedPublishers: readonly string[] = publishers.wallets, readLive: typeof fetch = fetch) {
  if (publications.length !== 2 || publications.map(p => p.release.chainId).sort((a, b) => a - b).join() !== "1,4663"
    || publications.some(p => p.manifest.packageId !== publications[0].manifest.packageId
      || p.manifest.requestDigest !== publications[0].manifest.requestDigest)) throw Error("Both networks must publish the identical source package.");
  await Promise.all(publications.map(async publication => {
    await verifyFoundationOwnerPublicationV1(publication, allowedPublishers);
    const response = await readLive(`https://programmable.market/api/module-foundation?chainId=${publication.release.chainId}`,
      { cache: "no-store", signal: AbortSignal.timeout(60_000), redirect: "error" });
    if (!response.ok) throw Error("The target host is not live.");
    const current = await response.json();
    if (!current.available || current.chainId !== publication.release.chainId
      || current.binding?.releaseDigest !== publication.protocolReleaseDigest) throw Error("The live target host differs from the staged module binding.");
  }));
}

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
    const publication = await verifyFoundationOwnerPublicationV1(JSON.parse(await readFile(path.join(targetDirectory, "publication.json"), "utf8")), publishers.wallets);
    if (publication.release.chainId !== target.chainId) throw Error("The staged module network differs.");
    const rpc = target.rpcEnvironment ? process.env[target.rpcEnvironment] : foundationChainProfile(target.chainId).publicRpcUrls[0];
    if (!rpc) throw Error("The target RPC is missing.");
    await verifyFoundationOwnerRuntimeV1(publication, createPublicClient({ chain: foundationChainProfile(target.chainId).chain, transport: http(rpc, { retryCount: 0, timeout: 30_000 }) }));
    publications.push(publication);
  }
  if (job.activate !== true) return;
  // The initial Ethereum release's seeded modules are not a permanent child-module allowlist.
  // Owner signatures and verified per-chain deployments admit new modules to the same live host.
  await verifySharedActivation(publications);
  const storage = JSON.parse(await readFile(flags.get("--storage-file")!, "utf8"));
  await publishCatalogBatch(publications, storage.token, (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }));
}
