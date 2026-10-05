import type { Metadata } from "next";
import { ModuleFoundationLaunchHost } from "@/components/module-foundation-launch-host";

export const metadata: Metadata = { title: "Launch a Coin · Programmable", description: "Create a fixed-supply coin with a Uniswap v4 pool and optional reviewed modules." };
export default async function FoundationLaunchPage({ searchParams }: { searchParams: Promise<{ chainId?: string | string[] }> }) {
  const { chainId } = await searchParams;
  if (chainId !== undefined && chainId !== "1" && chainId !== "4663") throw new Error("Choose one supported launch network.");
  return <ModuleFoundationLaunchHost key={chainId} layout="studio" chainId={chainId === "1" ? 1 : 4663} />;
}
