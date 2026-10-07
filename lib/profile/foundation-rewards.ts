import { erc20Abi, getAddress, type PublicClient } from "viem";
import { foundationLedgerAbi } from "@/lib/module-foundation/abi";
import { foundationBindingChainId, foundationChainProfile } from "@/lib/module-foundation/chains";
import { readFoundationLaunchRecord, type FoundationDeploymentBinding } from "@/lib/module-foundation/protocol";
import type { FoundationProfileLaunch } from "./module-launches";

export async function readFoundationProfileRewards(client: PublicClient, binding: FoundationDeploymentBinding, launch: FoundationProfileLaunch) {
  if (binding.releaseDigest.toLowerCase() !== launch.sourceReleaseDigest.toLowerCase()) throw new Error("The coin's fee release changed.");
  const chainId = foundationBindingChainId(binding);
  if (await client.getChainId() !== chainId) throw new Error("The fee provider is on a different network.");
  const blockNumber = await client.getBlockNumber();
  const registration = await readFoundationLaunchRecord(client, binding, getAddress(launch.tokenAddress), blockNumber);
  if (getAddress(registration.token) !== getAddress(launch.tokenAddress) || getAddress(registration.hook) !== getAddress(launch.hookAddress)
    || registration.poolId.toLowerCase() !== launch.poolId.toLowerCase() || BigInt(registration.ledger) === 0n
    || (launch.feeLedgerAddress && getAddress(registration.ledger) !== getAddress(launch.feeLedgerAddress))) {
    throw new Error("The fee ledger does not match this launch.");
  }
  const ledger = getAddress(registration.ledger);
  const [creator, quote, credited, claimed] = await Promise.all([
    client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "creator", blockNumber }),
    client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "quote", blockNumber }),
    client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "creatorCredited", blockNumber }),
    client.readContract({ address: ledger, abi: foundationLedgerAbi, functionName: "creatorClaimed", blockNumber }),
  ]);
  if (getAddress(creator) !== getAddress(launch.creator) || getAddress(quote) !== getAddress(launch.quoteAsset) || claimed > credited) {
    throw new Error("The fee recipient or asset does not match this launch.");
  }
  const wrappedEth = getAddress(quote) === foundationChainProfile(chainId).wrappedEth.address;
  const [decimals, symbol] = wrappedEth ? [18, "WETH"] as const : await Promise.all([
    client.readContract({ address: getAddress(quote), abi: erc20Abi, functionName: "decimals", blockNumber }),
    client.readContract({ address: getAddress(quote), abi: erc20Abi, functionName: "symbol", blockNumber }).catch(() => "quote tokens"),
  ]);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("The fee asset could not be read.");
  return { amount: credited - claimed, decimals, symbol: /^[A-Za-z0-9._-]{1,16}$/.test(symbol) ? symbol : "quote tokens", wrappedEth };
}
