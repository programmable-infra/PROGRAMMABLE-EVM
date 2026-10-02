import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import publishers from "@/config/module-foundation/owner-publishers.json";
import { validateModuleSubmissionRequest } from "@/packages/classic-modules/src/open-transport.mjs";
import { createFoundationModuleManifestV1, foundationDataDigest, hashFoundationModuleManifestV1, readFoundationPackageExtensionV1 } from "@/lib/module-foundation/manifest";
import { FOUNDATION_OWNER_CATALOG_PATH, FOUNDATION_OWNER_CATALOG_V1, FOUNDATION_OWNER_PUBLICATION_V1,
  foundationOwnerDigestV1, foundationOwnerSigningMessageV1, type FoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-publication";
import { verifyFoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-verification";
import { verifyFoundationOwnerRuntimeV1 } from "@/lib/module-foundation/owner-runtime";
import { readOptionalJson, readPassingTests, reconcileDeployment, testInputsDigest, writeCheckpoint, type DeploymentIntent } from "./journal";

const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function privateJson(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) throw Error("Private credential permissions differ.");
  return json(file);
}
export async function run(args: string[], repositoryRoot: string): Promise<void> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--job", "--wallet-file", "--storage-file", "--output"].includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw Error("Use job, wallet-file, storage-file and output.");
    flags.set(args[i], path.resolve(args[i + 1]));
  }
  if (flags.size !== 4) throw Error("Four publication inputs required.");
  const output = flags.get("--output")!; await mkdir(output, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  const save = (name: string, value: unknown) => writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const job = await json(flags.get("--job")!), credential = await privateJson(flags.get("--wallet-file")!), storage = await privateJson(flags.get("--storage-file")!);
  const account = privateKeyToAccount(credential.privateKey);
  if (!publishers.wallets.includes(account.address.toLowerCase()) || credential.address !== account.address || credential.chainId !== 4663) throw Error("Publication wallet differs.");
  const source = validateModuleSubmissionRequest(await json(path.resolve(job.sourceFile)));
  if (!source.ok) throw Error("Source package differs.");
  const prior = await readOptionalJson<FoundationOwnerPublicationV1>(path.join(output, "publication.json"));
  if (prior) {
    await verifyFoundationOwnerPublicationV1(prior, publishers.wallets);
    if (prior.publisher !== account.address || prior.manifest.requestDigest !== source.requestDigest) throw Error("Resume source or wallet differs.");
    const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com", { timeout: 15_000, retryCount: 0 }) });
    await verifyFoundationOwnerRuntimeV1(prior, client);
    await publishCatalog(prior, storage.token, save); return;
  }

  for (const file of source.request.files.filter(f => f.path.endsWith(".sol"))) {
    const bytes = await readFile(path.resolve(repositoryRoot, file.path));
    if (sha(bytes) !== file.sha256) throw Error("Local Solidity differs from the source package.");
  }
  if (!Array.isArray(job.testCommand) || job.testCommand.length < 1 || !job.testCommand.every((v: unknown) => typeof v === "string" && v.length)) throw Error("A focused module test command is required.");
  const identity = sha(JSON.stringify({ job, requestDigest: source.requestDigest, wallet: account.address }));
  const intent = await readOptionalJson<{ identity?: string; packageId: string; wallet: string; testCommand: string[] }>(path.join(output, "intent.json"));
  if (intent && (intent.identity ? intent.identity !== identity : intent.packageId !== source.packageId
    || intent.wallet !== account.address || JSON.stringify(intent.testCommand) !== JSON.stringify(job.testCommand))) throw Error("Resume job differs. Use a new run directory.");
  if (!intent) await save("intent.json", { identity, packageId: source.packageId, testCommand: job.testCommand, wallet: account.address, startedAt: new Date().toISOString() });
  const environment = { ...process.env, ...job.testEnvironment, PROGRAMMABLE_MODULE_WALLET_FILE: flags.get("--wallet-file")! };
  const artifacts = [job.factoryArtifact, job.moduleArtifact].map((file: string) => path.resolve(repositoryRoot, file));
  const inputsDigest = await testInputsDigest(repositoryRoot, job, environment);
  let tests = await readPassingTests(output, inputsDigest, artifacts);
  // One module-owned command compiles and exercises compatibility, launch, buy and sell behavior.
  // There is no contributor request, protected review worker, reviewer decision or browser login.
  if (!tests) {
    const report = execFileSync(job.testCommand[0], job.testCommand.slice(1), { cwd: repositoryRoot,
      encoding: "utf8", timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
      env: environment, stdio: ["ignore", "pipe", "pipe"] });
    if (await testInputsDigest(repositoryRoot, job, environment) !== inputsDigest) throw Error("Test inputs changed while the module tests ran.");
    await writeFile(path.join(output, "tests.log"), report, { mode: 0o600 });
    tests = { inputsDigest, reportHash: sha(report), artifactHashes: await Promise.all(artifacts.map(async file => sha(await readFile(file)))), completedAt: new Date().toISOString() };
    await writeCheckpoint(path.join(output, "tests-passed.json"), tests);
  }
  const factory = await json(path.resolve(repositoryRoot, job.factoryArtifact)), moduleArtifact = await json(path.resolve(repositoryRoot, job.moduleArtifact));
  if (!/^0x[0-9a-f]+$/i.test(factory.bytecode.object) || !/^0x[0-9a-f]+$/i.test(factory.deployedBytecode.object)
    || !/^0x[0-9a-f]+$/i.test(moduleArtifact.deployedBytecode.object)) throw Error("Compiled module bytecode is missing.");
  // A module with constructor immutables needs its deployed artifact, rather than a zero-filled template.
  for (const artifact of [factory, moduleArtifact]) {
    if (Object.keys(artifact.deployedBytecode.immutableReferences ?? {}).length || Object.keys(artifact.bytecode.linkReferences ?? {}).length) throw Error("Resolve immutable/library bytecode before publication.");
    const metadata = typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata;
    if (!metadata?.sources) throw Error("Compiler source metadata is missing.");
    for (const [name, pin] of Object.entries(metadata.sources) as [string, { keccak256: Hex }][]) {
      const file = source.request.files.find(f => f.path === name || f.path === "contracts/" + name);
      if (!file || keccak256(Buffer.from(file.bytes, "base64")) !== pin.keccak256) throw Error("Compiled sources differ from the package.");
    }
  }
  const rpcUrl = "https://rpc.mainnet.chain.robinhood.com";
  const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 0 }) });
  if (await client.getChainId() !== chain.id) throw Error("Deployment network differs.");
  let transactionHash: Hex = job.deploymentTransactionHash;
  let receipt;
  if (!transactionHash) {
    const wallet = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 0 }) });
    const data = factory.bytecode.object as Hex;
    let deploymentIntent = await readOptionalJson<DeploymentIntent>(path.join(output, "deployment-intent.private.json"));
    if (!deploymentIntent) {
      const [estimate, quotedGasPrice] = await Promise.all([client.estimateGas({ account, data, value: 0n }), client.getGasPrice()]);
      const gas = (estimate * 120n + 99n) / 100n, gasPrice = quotedGasPrice * 120n / 100n;
      const cost = gas * gasPrice, budget = BigInt(job.maximumGasCostWei ?? "1000000000000000");
      if (cost > budget || await client.getBalance({ address: account.address }) < cost) throw Error("Deployment gas exceeds available funding or job budget.");
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const serialized = await account.signTransaction({ chainId: 4663, type: "legacy", data, value: 0n, gas, gasPrice, nonce });
      transactionHash = keccak256(serialized);
      deploymentIntent = { transactionHash, serialized, nonce, maximumCostWei: cost.toString() };
      await save("deployment-intent.private.json", deploymentIntent);
    }
    transactionHash = deploymentIntent.transactionHash;
    receipt = await reconcileDeployment(deploymentIntent, account.address, keccak256(data), client,
      serializedTransaction => wallet.sendRawTransaction({ serializedTransaction }));
  } else {
    receipt = await client.getTransactionReceipt({ hash: transactionHash });
  }
  if (receipt.status !== "success" || !receipt.contractAddress) throw Error("Factory deployment failed.");
  const response = await fetch("https://programmable.market/api/module-foundation", { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  const availability = await response.json();
  if (!response.ok || !availability.available || !availability.binding?.releaseDigest) throw Error("Module host is unavailable.");
  const manifest = createFoundationModuleManifestV1(source.request.descriptor, source.requestDigest as Hex), extension = readFoundationPackageExtensionV1(manifest);
  const deployment = { transactionHash, blockNumber: receipt.blockNumber.toString(), creationCodeHash: keccak256(factory.bytecode.object as Hex) };
  const runtimePins = { factory: receipt.contractAddress, factoryCodeHash: keccak256(factory.deployedBytecode.object as Hex), moduleCodeHash: keccak256(moduleArtifact.deployedBytecode.object as Hex), descriptorHash: extension.descriptorHash };
  const release = { chainId: 4663, hostAdapterId: extension.hostAdapterId, manifestHash: hashFoundationModuleManifestV1(manifest), ...runtimePins,
    releaseDigest: foundationDataDigest("programmable.module-foundation.owner-release.v1", { protocolReleaseDigest: availability.binding.releaseDigest, deployment, runtimePins, packageId: manifest.packageId }),
    deploymentEvidenceDigest: foundationDataDigest("programmable.module-foundation.owner-deployment.v1", deployment),
    runtimeVerificationDigest: foundationDataDigest("programmable.module-foundation.owner-runtime.v1", runtimePins) };
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const sourceCommitted = source.request.files.filter(f => f.path.endsWith(".sol")).every(file => {
    try { return sha(execFileSync("git", ["show", `${head}:${file.path}`], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "ignore"] })) === file.sha256; }
    catch { return false; }
  });
  const contents = { schemaVersion: FOUNDATION_OWNER_PUBLICATION_V1, publisher: account.address,
    sourceCommit: sourceCommitted ? head : null,
    publishedAt: new Date().toISOString(), protocolReleaseDigest: availability.binding.releaseDigest as Hex,
    source: source.request, manifest, release, deployment,
    tests: { command: job.testCommand as string[], reportHash: `0x${tests.reportHash}` as Hex, completedAt: tests.completedAt, success: true as const } };
  const publicationDigest = foundationOwnerDigestV1(contents), signature = await account.signMessage({ message: foundationOwnerSigningMessageV1(publicationDigest) });
  const publication: FoundationOwnerPublicationV1 = { ...contents, publicationDigest, signature };
  await verifyFoundationOwnerPublicationV1(publication, publishers.wallets);
  await verifyFoundationOwnerRuntimeV1(publication, client);
  await save("publication.json", publication);
  await publishCatalog(publication, storage.token, save);
}

export async function publishCatalog(publication: FoundationOwnerPublicationV1, storageToken: string, save: (name: string, value: unknown) => Promise<void>) {
  const publicationDigest = publication.publicationDigest;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await get(FOUNDATION_OWNER_CATALOG_PATH, { token: storageToken, access: "private", useCache: false });
    let publications: FoundationOwnerPublicationV1[] = [], etag: string | undefined;
    if (existing) {
      if (existing.statusCode !== 200 || !existing.stream) throw Error("Catalogue read failed.");
      const old = JSON.parse(await new Response(existing.stream).text());
      if (old.schemaVersion !== FOUNDATION_OWNER_CATALOG_V1 || !Array.isArray(old.publications) || old.publications.length > 256) throw Error("Catalogue format differs.");
      for (let offset = 0; offset < old.publications.length; offset += 4) {
        await Promise.all(old.publications.slice(offset, offset + 4).map((p: unknown) => verifyFoundationOwnerPublicationV1(p, publishers.wallets)));
      }
      publications = old.publications; etag = existing.blob.etag;
    }
    const alreadyStored = publications.some(p => p.publicationDigest === publication.publicationDigest);
    if (!alreadyStored) publications = [...publications.filter(p => p.manifest.packageId !== publication.manifest.packageId), publication];
    await save("publication-intent.json", { publicationDigest, priorEtag: etag ?? null }).catch(async error => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    const catalog = { schemaVersion: FOUNDATION_OWNER_CATALOG_V1, publications };
    if (publications.length > 256) throw Error("Catalogue is full.");
    try {
      if (!alreadyStored) await put(FOUNDATION_OWNER_CATALOG_PATH, JSON.stringify(catalog), { token: storageToken, access: "private", contentType: "application/json",
        addRandomSuffix: false, allowOverwrite: !!existing, ...(etag ? { ifMatch: etag } : {}), cacheControlMaxAge: 0 });
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) || attempt === 2) throw error;
      continue; // Merge the current catalog again; never rebuild, retest, sign or deploy again.
    }
    const readback = await get(FOUNDATION_OWNER_CATALOG_PATH, { token: storageToken, access: "private", useCache: false });
    if (!readback || readback.statusCode !== 200 || !readback.stream) throw Error("Publication readback differs.");
    const stored = JSON.parse(await new Response(readback.stream).text());
    const match = stored.schemaVersion === FOUNDATION_OWNER_CATALOG_V1 && Array.isArray(stored.publications)
      ? stored.publications.find((p: FoundationOwnerPublicationV1) => p.publicationDigest === publicationDigest) : null;
    if (!match) throw Error("Publication readback differs.");
    await verifyFoundationOwnerPublicationV1(match, publishers.wallets);
    break;
  }
  await save("complete.json", { packageId: publication.manifest.packageId, publicationDigest, factory: publication.release.factory, publisher: publication.publisher, completedAt: new Date().toISOString() }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  console.log(JSON.stringify({ status: "published", packageId: publication.manifest.packageId, publicationDigest, factory: publication.release.factory, publisher: publication.publisher }));
}
