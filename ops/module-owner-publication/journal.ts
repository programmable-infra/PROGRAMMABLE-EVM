import { readFile, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex, type PublicClient, type TransactionSerialized } from "viem";

export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function readOptionalJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return null; }
}
export async function writeCheckpoint(file: string, value: unknown): Promise<void> {
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await rename(temporary, file);
}

/** Check actual working files, including untracked tests, rather than trusting a commit label. */
export async function testInputsDigest(root: string, job: unknown, environment: Record<string, string | undefined>): Promise<string> {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  hash.update(JSON.stringify(job));
  hash.update(JSON.stringify(Object.entries(environment).filter(([key]) => !["_", "PWD", "OLDPWD", "SHLVL"].includes(key)).sort(([a], [b]) => a.localeCompare(b))));
  for (let offset = 0; offset < files.length; offset += 16) {
    const batch = await Promise.all(files.slice(offset, offset + 16).map(async file => {
      try { return [file, sha256(await readFile(path.join(root, file)))]; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return [file, "deleted"]; }
    }));
    for (const record of batch) hash.update(JSON.stringify(record));
  }
  return hash.digest("hex");
}
export interface PassingTests {
  inputsDigest: string; reportHash: string; artifactHashes: string[]; completedAt: string;
}
export async function readPassingTests(output: string, digest: string, artifacts: string[]): Promise<PassingTests | null> {
  const checkpoint = await readOptionalJson<PassingTests>(path.join(output, "tests-passed.json"));
  if (!checkpoint || checkpoint.inputsDigest !== digest) return null;
  try {
    const hashes = await Promise.all(artifacts.map(async file => sha256(await readFile(file))));
    if (checkpoint.reportHash !== sha256(await readFile(path.join(output, "tests.log")))
      || JSON.stringify(hashes) !== JSON.stringify(checkpoint.artifactHashes)) return null;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return null; }
  return checkpoint;
}
export interface DeploymentIntent { transactionHash: Hex; serialized: Hex; nonce: number; maximumCostWei: string; }
/** An uncertain broadcast can only resend the identical signed transaction; it never takes a new nonce. */
export async function reconcileDeployment(intent: DeploymentIntent, address: Address, creationCodeHash: Hex,
  client: PublicClient, broadcast: (serialized: Hex) => Promise<Hex>, chainId: 1 | 4663 = 4663) {
  const transaction = parseTransaction(intent.serialized);
  if (keccak256(intent.serialized) !== intent.transactionHash || transaction.chainId !== chainId
    || transaction.to != null || (transaction.value ?? 0n) !== 0n || !transaction.data
    || keccak256(transaction.data) !== creationCodeHash || transaction.nonce !== intent.nonce
    || (await recoverTransactionAddress({ serializedTransaction: intent.serialized as TransactionSerialized })).toLowerCase() !== address.toLowerCase()) throw Error("Saved deployment differs from the wallet or compiled factory.");
  try { return await client.getTransactionReceipt({ hash: intent.transactionHash }); }
  catch (error) { if ((error as Error).name !== "TransactionReceiptNotFoundError") throw error; }
  try { await client.getTransaction({ hash: intent.transactionHash }); }
  catch (error) {
    if ((error as Error).name !== "TransactionNotFoundError") throw error;
    if (await broadcast(intent.serialized) !== intent.transactionHash) throw Error("Broadcast hash differs.");
  }
  return client.waitForTransactionReceipt({ hash: intent.transactionHash, timeout: 90_000 });
}
