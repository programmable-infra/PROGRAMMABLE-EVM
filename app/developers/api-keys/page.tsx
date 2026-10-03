import type { Metadata } from "next";

import { DeveloperApiKeys } from "@/components/developer-api-keys";
import { developerApiKeysInitialSection } from "@/lib/developer-api-key-route";
import { buildProgrammableAgentSetupTextV1 } from "@/lib/custom-launch/agent-setup-v1";
import { V4_API_PROFILE_VERSION } from "@/lib/custom-launch/v4-api-discovery";
import { readLaunchContractSetupV1 } from "@/lib/server/custom-launch/launch-contract-setup-v1";

export const metadata: Metadata = {
  title: "Programmable",
  description:
    "Create a key for your builder, manage its access and review custom hook launches.",
  alternates: {
    canonical: "/developers/api-keys",
  },
};

type DeveloperApiKeysSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function DeveloperApiKeysPage({
  searchParams,
}: Readonly<{ searchParams: DeveloperApiKeysSearchParams }>) {
  const resolvedSearchParams = await searchParams;
  const launchContractSetup = await readLaunchContractSetupV1().catch(() => null);
  return (
    <DeveloperApiKeys
      initialSection={developerApiKeysInitialSection(resolvedSearchParams)}
      initialGuideOpen={resolvedSearchParams.guide === "custom-hook"}
      agentSetupText={buildProgrammableAgentSetupTextV1(V4_API_PROFILE_VERSION)}
      launchContractSetup={launchContractSetup ?? undefined}
    />
  );
}
