import { erc20Abi, getAddress, type Address, type Hex } from "viem";
import { fetchModuleEngineAvailability, assertModuleEngineOperationAvailability } from "@/lib/module-engine/availability-client";
import { readModuleEngineAdministration, readModuleEngineLaunch, prepareModuleEngineClaim, observeModuleEngineReceipt,
  type ModuleEngineClient } from "@/lib/module-engine/client";
import { readModuleManagementSnapshot } from "@/lib/module-mode/management";
import { parseModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import { prepareModuleNativeManagementTransaction, waitForModuleNativeReceipt } from "@/lib/module-mode/native-client";
import { isRobinhoodEngineLaunch, type RobinhoodNativeModuleLaunch, type RobinhoodEngineLaunch } from "@/lib/robinhood-launches";

export type LegacyProfileLaunch = RobinhoodNativeModuleLaunch | RobinhoodEngineLaunch;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Original releases retain their own claim protocol, including shared-ledger balances. */
export async function readLegacyModuleRewards(client: ModuleEngineClient, launch: LegacyProfileLaunch, account: Address, signal?: AbortSignal) {
  if (!same(account, launch.creator)) throw new Error("Connect the wallet that launched this coin.");
  const token = getAddress(launch.tokenAddress);
  if (isRobinhoodEngineLaunch(launch)) {
    const availability = await fetchModuleEngineAvailability(launch.sourceReleaseDigest as Hex, signal);
    if (!availability.release) throw new Error("This coin's fee version is temporarily unavailable.");
    const release = availability.release;
    const registered = await readModuleEngineLaunch({ client, release, token });
    if (!same(registered.creator, account) || !same(registered.launchId, launch.launchId)) throw new Error("The launch wallet could not be verified.");
    const template = availability.templates.find(item => item.manifest.manifest.revision.packageId === registered.revisionId);
    if (!template) throw new Error("This coin's fee version is temporarily unavailable.");
    const snapshot = await readModuleEngineAdministration({ client, release, template, token, account });
    const asset = snapshot.fees.feeAsset;
    const symbol = asset && BigInt(asset) !== 0n
      ? await client.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }).catch(() => "quote tokens") : "ETH";
    return { kind: "engine" as const, availability, release, amount: snapshot.fees.claimable,
      decimals: snapshot.fees.feeDecimals ?? 18, symbol: typeof symbol === "string" && /^[A-Za-z0-9._-]{1,16}$/.test(symbol) ? symbol : "quote tokens" };
  }
  const response = await fetch(`/api/module-mode?releaseDigest=${launch.sourceReleaseDigest}`, {
    cache: "no-store", credentials: "same-origin", redirect: "error", signal,
  });
  if (!response.ok || response.redirected || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    throw new Error("This coin's fee version is temporarily unavailable.");
  }
  const availability = parseModuleModeAvailability(await response.json());
  if (!availability.release || !same(availability.release.releaseDigest, launch.sourceReleaseDigest)) throw new Error("The fee version changed.");
  const snapshot = await readModuleManagementSnapshot({ client, release: availability.release, catalog: availability.catalog, token, actor: account });
  if (!same(snapshot.launch.launchWallet, account) || !same(snapshot.launch.launchId, launch.launchId)) throw new Error("The launch wallet could not be verified.");
  if (snapshot.fees.claimable === null) throw new Error("Rewards could not be checked.");
  return { kind: "native" as const, availability, release: availability.release, amount: snapshot.fees.claimable, decimals: 18, symbol: "ETH" };
}

export async function prepareLegacyModuleRewards(client: ModuleEngineClient, launch: LegacyProfileLaunch, account: Address) {
  const state = await readLegacyModuleRewards(client, launch, account);
  if (state.amount <= 0n) throw new Error("No rewards are available to claim.");
  const token = getAddress(launch.tokenAddress);
  if (state.kind === "engine") {
    const prepared = await prepareModuleEngineClaim({ client, release: state.release, token, account, recipient: account });
    assertModuleEngineOperationAvailability(prepared, state.availability, await fetchModuleEngineAvailability(prepared.releaseDigest));
    return { prepared, confirm: (transactionHash: Hex) => observeModuleEngineReceipt(prepared, transactionHash) };
  }
  const block = await client.getBlock({ blockTag: "latest" });
  const prepared = await prepareModuleNativeManagementTransaction({ client, release: state.release, catalog: state.availability.catalog,
    token, actor: account, intent: { kind: "claim-fees", recipient: account }, deadline: block.timestamp + 300n });
  return { prepared, confirm: (transactionHash: Hex) => waitForModuleNativeReceipt({ client, prepared, transactionHash }) };
}
