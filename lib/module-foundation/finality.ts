import type { PublicClient } from "viem";
import { foundationChainProfile, type FoundationChainId } from "./chains";

/** Preparation can use recent prices. Restoring a launch requires the chain's indexing finality. */
export async function assertFoundationLaunchFinality(client: PublicClient, chainId: FoundationChainId,
  launchBlock: bigint, observedBlock: bigint): Promise<void> {
  const confirmations = foundationChainProfile(chainId).launchConfirmations;
  if (launchBlock < 0n || launchBlock > observedBlock) throw new Error("The launch is not in the observed chain history.");
  if (confirmations === 0 || observedBlock - launchBlock + 1n >= BigInt(confirmations)) return;
  const finalized = await client.getBlock({ blockTag: "finalized" });
  if (finalized.number === null || !finalized.hash || finalized.number < launchBlock || finalized.number > observedBlock) {
    throw new Error("The launch is confirmed and is waiting for Ethereum finality.");
  }
}
