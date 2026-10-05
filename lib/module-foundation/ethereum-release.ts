import { getAddress, type Hex } from "viem";
import release from "@/contracts/deployments/ethereum-module-release-v1.json";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import type { FoundationEthereumGraphSource } from "./ethereum-graph";
import type { FoundationDeploymentBinding } from "./protocol";
import { FOUNDATION_LP_CUSTODY_DEAD_ID } from "./constants";

/** Installed source identity. Activation and current chain evidence are supplied separately. */
export const ETHEREUM_MODULE_SOURCE: FoundationEthereumGraphSource = Object.freeze({
  chainId: 1, releaseDigest: release.releaseDigest as Hex,
  sourceCommit: release.payload.sourceCommit, startBlock: BigInt(release.payload.startBlock),
  implementation: { address: getAddress(release.payload.implementation.address),
    runtimeCodeHash: release.payload.implementation.runtimeCodeHash as Hex },
  proxyRuntimeCodeHash: release.payload.proxyRuntimeCodeHash as Hex,
});
export const ETHEREUM_MODULE_BINDING: FoundationDeploymentBinding = Object.freeze({
  chainId: 1, factoryVersion: "v3", lpCustodyId: FOUNDATION_LP_CUSTODY_DEAD_ID,
  releaseDigest: ETHEREUM_MODULE_SOURCE.releaseDigest, sourceCommit: ETHEREUM_MODULE_SOURCE.sourceCommit,
  startBlock: ETHEREUM_MODULE_SOURCE.startBlock, factory: ETHEREUM_MODULE_SOURCE.implementation,
  hookDeployer: { address: getAddress(ethereum.canonicalStamp.graphFactory.address),
    runtimeCodeHash: ethereum.canonicalStamp.graphFactory.runtimeCodeHash as Hex },
  ethereumGraph: ETHEREUM_MODULE_SOURCE,
});

/** Routing hint from a canonical stamp. Market reads still verify the proxy's
 * implementation, initializer, runtime and pool before enabling any action. */
export function isEthereumModuleLaunchCandidate(entry: { launchStampProvenance?: import("@/lib/tokens").LaunchStampProvenanceV1 | null } | null | undefined): boolean {
  const stamp = entry?.launchStampProvenance;
  return !!stamp && stamp.chainId === 1 && stamp.kind === "custom-graph"
    && stamp.routerAddress.toLowerCase() === ethereum.canonicalStamp.router.address.toLowerCase()
    && stamp.routeLauncherAddress.toLowerCase() === ethereum.canonicalStamp.graphFactory.address.toLowerCase()
    && BigInt(stamp.blockNumber) >= ETHEREUM_MODULE_SOURCE.startBlock
    && stamp.components.length === 3
    && stamp.components.filter(component => component.kind === "other" && component.scope === "exclusive"
      && component.runtimeCodeHash.toLowerCase() === ETHEREUM_MODULE_SOURCE.proxyRuntimeCodeHash.toLowerCase()).length === 1;
}
