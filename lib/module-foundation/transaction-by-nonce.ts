import { getAddress, type Address, type PublicClient } from "viem";

/** Locate a mined wallet request without an explorer or a wallet-provided hash. */
export async function findFoundationTransactionByNonce(client: PublicClient, account: Address, nonce: number, startBlock: bigint) {
  const head = await client.getBlock({ blockTag: "latest" });
  if (head.number === null || !head.hash || head.number < startBlock) throw new Error("Wallet activity could not be checked yet.");
  let low = startBlock, high = head.number;
  const count = (blockNumber: bigint) => client.getTransactionCount({ address: account, blockNumber });
  if (await count(high) <= nonce) throw new Error("This request is not confirmed yet. Finish or cancel it in your wallet, then check again.");
  if (low > 0n && await count(low - 1n) > nonce) throw new Error("The saved request does not match this wallet's transaction history.");
  // At most 32 historical reads, even for an old interrupted session.
  for (let reads = 0; low < high; reads++) {
    if (reads === 32) throw new Error("This request needs its transaction hash from wallet activity.");
    const middle = (low + high) / 2n;
    if (await count(middle) > nonce) high = middle;
    else low = middle + 1n;
  }
  const block = await client.getBlock({ blockNumber: low, includeTransactions: true });
  const transaction = block.transactions.find(tx => typeof tx !== "string" && getAddress(tx.from) === getAddress(account) && tx.nonce === nonce);
  if (!transaction || typeof transaction === "string" || transaction.blockHash !== block.hash || transaction.blockNumber !== low) {
    throw new Error("Wallet activity changed during recovery. Check again.");
  }
  return transaction;
}
