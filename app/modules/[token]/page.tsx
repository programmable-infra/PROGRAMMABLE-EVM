import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAddress, isAddress, type Hex } from "viem";
import { ModuleFoundationMarketHost } from "@/components/module-foundation-market-host";

export const metadata: Metadata = { title: "Coin · Programmable", description: "View the coin, its chart and project links on Programmable." };
export default async function FoundationCoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ transaction?: string; chainId?: string }> }) {
  const { token } = await params;
  const { transaction, chainId } = await searchParams;
  if (!isAddress(token) || (chainId !== undefined && chainId !== "1" && chainId !== "4663")) notFound();
  return <ModuleFoundationMarketHost key={`${chainId}:${token}`} chainId={chainId === "1" ? 1 : 4663} token={getAddress(token)} transactionHash={transaction && /^0x[0-9a-fA-F]{64}$/.test(transaction) ? transaction as Hex : undefined} />;
}
