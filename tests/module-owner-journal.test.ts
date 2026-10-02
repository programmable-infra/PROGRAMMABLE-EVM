import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, type PublicClient } from "viem";
import { readPassingTests, reconcileDeployment, sha256, testInputsDigest, writeCheckpoint } from "@/ops/module-owner-publication/journal";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`), data = "0x6000" as const;
async function intent() {
  const serialized = await account.signTransaction({ chainId: 4663, type: "legacy", nonce: 7, gas: 100000n, gasPrice: 1n, data, value: 0n });
  return { serialized, nonce: 7, transactionHash: keccak256(serialized), maximumCostWei: "100000" };
}
const missing = (name: string) => Object.assign(Error("not found"), { name });
it("reconciles a mined deployment without another transaction or nonce", async () => {
  const saved = await intent(), receipt = { status: "success" }, broadcast = vi.fn();
  const client = { getTransactionReceipt: vi.fn(async () => receipt), getTransaction: vi.fn(), waitForTransactionReceipt: vi.fn() };
  await expect(reconcileDeployment(saved, account.address, keccak256(data), client as unknown as PublicClient, broadcast)).resolves.toBe(receipt);
  expect(broadcast).not.toHaveBeenCalled();
  expect(client.getTransaction).not.toHaveBeenCalled();
});
it("resends the identical transaction after an uncertain broadcast, and rejects changed factory bytes", async () => {
  const saved = await intent(), receipt = { status: "success" };
  const client = { getTransactionReceipt: vi.fn(async () => { throw missing("TransactionReceiptNotFoundError"); }),
    getTransaction: vi.fn(async () => { throw missing("TransactionNotFoundError"); }), waitForTransactionReceipt: vi.fn(async () => receipt) };
  const broadcast = vi.fn().mockRejectedValueOnce(Error("network interrupted")).mockResolvedValue(saved.transactionHash);
  await expect(reconcileDeployment(saved, account.address, keccak256(data), client as unknown as PublicClient, broadcast)).rejects.toThrow("interrupted");
  await expect(reconcileDeployment(saved, account.address, keccak256(data), client as unknown as PublicClient, broadcast)).resolves.toBe(receipt);
  expect(broadcast.mock.calls).toEqual([[saved.serialized], [saved.serialized]]);
  await expect(reconcileDeployment(saved, account.address, keccak256("0x6001"), client as unknown as PublicClient, broadcast)).rejects.toThrow("differs");
  client.getTransactionReceipt.mockRejectedValueOnce(Error("RPC unavailable"));
  await expect(reconcileDeployment(saved, account.address, keccak256(data), client as unknown as PublicClient, broadcast)).rejects.toThrow("RPC unavailable");
  expect(broadcast).toHaveBeenCalledTimes(2);
});
it("reuses passing tests only while working sources, command, environment, report and artifacts match", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "module-publish-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    await writeFile(path.join(root, "module.sol"), "source");
    const artifact = path.join(root, "artifact.json"), report = path.join(root, "tests.log");
    // Outputs must not become test inputs, as in the repository's ignored contract output.
    await writeFile(path.join(root, ".gitignore"), "artifact.json\ntests.log\ntests-passed.json\n");
    await writeFile(artifact, "compiled"); await writeFile(report, "passed");
    const job = { testCommand: ["module-test"] }, environment = { MODULE_TEST: "1" };
    const digest = await testInputsDigest(root, job, environment);
    const checkpoint = { inputsDigest: digest, reportHash: sha256(await readFile(report)), artifactHashes: [sha256(await readFile(artifact))], completedAt: new Date().toISOString() };
    await writeCheckpoint(path.join(root, "tests-passed.json"), checkpoint);
    await expect(readPassingTests(root, await testInputsDigest(root, job, environment), [artifact])).resolves.toEqual(checkpoint);
    expect(await testInputsDigest(root, { testCommand: ["different"] }, environment)).not.toBe(digest);
    expect(await testInputsDigest(root, job, { MODULE_TEST: "2" })).not.toBe(digest);
    await writeFile(path.join(root, "module.sol"), "changed source");
    await expect(readPassingTests(root, await testInputsDigest(root, job, environment), [artifact])).resolves.toBeNull();
    await writeFile(artifact, "changed compile");
    await expect(readPassingTests(root, digest, [artifact])).resolves.toBeNull();
    await writeFile(artifact, "compiled"); await writeFile(report, "changed report");
    await expect(readPassingTests(root, digest, [artifact])).resolves.toBeNull();
  } finally { await rm(root, { recursive: true, force: true }); }
});
