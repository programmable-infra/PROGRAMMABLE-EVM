import { foundationChainProfile } from "./chains";
import { assertFoundationLaunchFinality } from "./finality";
import { keccak256, type PublicClient } from "viem";
import type { FoundationOwnerPublicationV1 } from "./owner-publication";

const pending = new WeakMap<PublicClient, Map<string, Promise<void>>>();

export async function verifyFoundationOwnerRuntimeV1(publication: FoundationOwnerPublicationV1, client: PublicClient): Promise<void> {
  const key = JSON.stringify([publication.deployment, publication.release]);
  let reads = pending.get(client);
  if (!reads) { reads = new Map(); pending.set(client, reads); }
  const existing = reads.get(key);
  if (existing) return existing;
  const verification = readRuntime(publication, client);
  reads.set(key, verification);
  try { await verification; } finally { if (reads.get(key) === verification) reads.delete(key); }
}

async function readRuntime(publication: FoundationOwnerPublicationV1, client: PublicClient): Promise<void> {
  const expectedChainId = foundationChainProfile(publication.release.chainId).chainId;
  // All inputs are already signed, so independent reads need no serial RPC rounds.
  const [chainId, receipt, transaction, code, block] = await Promise.all([
    client.getChainId(),
    client.getTransactionReceipt({ hash: publication.deployment.transactionHash }),
    client.getTransaction({ hash: publication.deployment.transactionHash }),
    client.getCode({ address: publication.release.factory }),
    client.getBlock({ blockNumber: BigInt(publication.deployment.blockNumber) }),
  ]);
  if (chainId !== expectedChainId || (transaction.chainId !== undefined && transaction.chainId !== expectedChainId)) throw new Error("Owner module RPC network differs.");
  if (receipt.status !== "success" || receipt.contractAddress?.toLowerCase() !== publication.release.factory.toLowerCase()
    || receipt.blockNumber.toString() !== publication.deployment.blockNumber || receipt.transactionHash !== transaction.hash
    || transaction.to !== null || transaction.value !== 0n || keccak256(transaction.input) !== publication.deployment.creationCodeHash
    || !code || code === "0x" || keccak256(code) !== publication.release.factoryCodeHash) throw new Error("Owner module deployment or runtime differs.");
  if (block.hash !== receipt.blockHash || transaction.blockHash !== receipt.blockHash) throw new Error("Owner module deployment is not canonical.");
  if (expectedChainId === 1) await assertFoundationLaunchFinality(client, expectedChainId, receipt.blockNumber, await client.getBlockNumber({ cacheTime: 0 }));
}
