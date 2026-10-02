import { keccak256, type PublicClient } from "viem";
import type { FoundationOwnerPublicationV1 } from "./owner-publication";

export async function verifyFoundationOwnerRuntimeV1(publication: FoundationOwnerPublicationV1, client: PublicClient): Promise<void> {
  if (await client.getChainId() !== 4663) throw new Error("Owner module RPC network differs.");
  const [receipt, transaction, code] = await Promise.all([
    client.getTransactionReceipt({ hash: publication.deployment.transactionHash }),
    client.getTransaction({ hash: publication.deployment.transactionHash }),
    client.getCode({ address: publication.release.factory }),
  ]);
  if (receipt.status !== "success" || receipt.contractAddress?.toLowerCase() !== publication.release.factory.toLowerCase()
    || receipt.blockNumber.toString() !== publication.deployment.blockNumber || receipt.transactionHash !== transaction.hash
    || transaction.to !== null || transaction.value !== 0n || keccak256(transaction.input) !== publication.deployment.creationCodeHash
    || !code || code === "0x" || keccak256(code) !== publication.release.factoryCodeHash) throw new Error("Owner module deployment or runtime differs.");
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash || transaction.blockHash !== receipt.blockHash) throw new Error("Owner module deployment is not canonical.");
}
