import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress, isAddress, type Hex } from "viem";
import { ModuleFoundationMarketHost } from "@/components/module-foundation-market-host";
import { findRecentFoundationLaunch } from "@/lib/server/module-foundation/recent-launch-store";
import { resolveTokenPage } from "@/lib/server/token-page";
import { ethereumFoundationPresentation } from "@/lib/launch-presentation-details";
import { isEthereumModuleLaunchCandidate } from "@/lib/module-foundation/ethereum-release";
import { isRobinhoodFoundationLaunch } from "@/lib/robinhood-launches";

export const metadata: Metadata = { title: "Coin · Programmable", description: "View the coin, its chart and project links on Programmable." };
export default async function FoundationCoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ transaction?: string; chainId?: string }> }) {
  const { token } = await params;
  const { transaction, chainId } = await searchParams;
  if (!isAddress(token) || (chainId !== undefined && chainId !== "1" && chainId !== "4663")) notFound();
  const recent = await findRecentFoundationLaunch(chainId === "1" ? 1 : 4663, token).catch(() => null);
  // A direct /modules URL also keeps the indexed ticker and pair when the
  // optional market feed or current wallet authority is unavailable.
  const indexed = recent ? null : await resolveTokenPage(token, chainId === "1" ? "1" : "4663");
  const launch = recent?.row ?? (indexed?.chainId === 1 && indexed.token && isEthereumModuleLaunchCandidate(indexed.token)
    ? ethereumFoundationPresentation(indexed.token) : indexed?.chainId === 4663 && isRobinhoodFoundationLaunch(indexed.token) ? indexed.token : undefined);
  const name = recent?.row.name ?? (indexed?.chainId === 1 || indexed?.chainId === 4663 ? indexed.token?.name : undefined);
  return <ModuleFoundationMarketHost key={`${chainId}:${token}`} chainId={chainId === "1" ? 1 : 4663} token={getAddress(token)}
    initialName={name ?? undefined} initialLaunch={launch}
    initialPresentation={recent ? Promise.resolve(recent.presentation) : undefined}
    transactionHash={transaction && /^0x[0-9a-fA-F]{64}$/.test(transaction) ? transaction as Hex : undefined} />;
}
