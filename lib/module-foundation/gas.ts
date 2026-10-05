import { foundationChainProfile, type FoundationChainId } from "./chains";

// EIP-7825 applies to each Ethereum transaction, including its gas-limit field.
export const ETHEREUM_TRANSACTION_GAS_CAP = 16_777_216n;

export function foundationTransactionGasLimit(estimate: bigint, chainId: FoundationChainId = 4663): bigint {
  foundationChainProfile(chainId);
  if (estimate <= 0n) throw new Error("The transaction gas limit could not be estimated.");
  const buffered = estimate * 120n / 100n + 15_000n;
  if (chainId !== 1) return buffered;
  if (estimate > ETHEREUM_TRANSACTION_GAS_CAP) throw new Error("This module combination exceeds Ethereum's transaction gas limit.");
  return buffered > ETHEREUM_TRANSACTION_GAS_CAP ? ETHEREUM_TRANSACTION_GAS_CAP : buffered;
}
