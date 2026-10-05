import { getAddress, type Address, type Chain, type Hex, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { robinhoodChain, ROBINHOOD_MULTICALL3_ADDRESS, ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH } from "@/lib/chains";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import { FOUNDATION_CHAIN_ID, FOUNDATION_INFRASTRUCTURE } from "./constants";

export type FoundationChainId = 1 | 4663;
export type FoundationInfrastructureRole = keyof typeof FOUNDATION_INFRASTRUCTURE;
export interface FoundationRuntimePin { address: Address; runtimeCodeHash: Hex }
export interface FoundationChainProfile {
  chainId: FoundationChainId; chain: Chain; name: string; explorer: string;
  infrastructure: Readonly<Record<FoundationInfrastructureRole, FoundationRuntimePin>>;
  wrappedEth: FoundationRuntimePin; multicall3: FoundationRuntimePin;
  /** Fresh preparation state is separate from launch discovery finality. */
  preparationLag: bigint; launchConfirmations: number;
  publicRpcUrls: readonly string[];
}
function pin(value: { address: string; runtimeCodeHash: string }): FoundationRuntimePin {
  return Object.freeze({ address: getAddress(value.address), runtimeCodeHash: value.runtimeCodeHash as Hex });
}
const ethereumInfrastructure = Object.freeze(Object.fromEntries(Object.keys(FOUNDATION_INFRASTRUCTURE).map(role =>
  [role, pin(ethereum.contracts[role as FoundationInfrastructureRole])])) as Record<FoundationInfrastructureRole, FoundationRuntimePin>);
const profiles: Readonly<Record<FoundationChainId, FoundationChainProfile>> = Object.freeze({
  4663: Object.freeze({ chainId: 4663, chain: robinhoodChain, name: "Robinhood Chain", explorer: "https://robinhoodchain.blockscout.com",
    infrastructure: Object.freeze(Object.fromEntries(Object.entries(FOUNDATION_INFRASTRUCTURE).map(([role, value]) => [role, Object.freeze(value)]))) as FoundationChainProfile["infrastructure"],
    wrappedEth: pin({ address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", runtimeCodeHash: "0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353" }),
    multicall3: pin({ address: ROBINHOOD_MULTICALL3_ADDRESS, runtimeCodeHash: ROBINHOOD_MULTICALL3_RUNTIME_CODE_HASH }),
    preparationLag: 16n, launchConfirmations: 0,
    publicRpcUrls: Object.freeze(["https://rpc-robinhood.blockmachine.io", "https://rpc.mainnet.chain.robinhood.com"]) }),
  1: Object.freeze({ chainId: 1, chain: mainnet, name: "Ethereum", explorer: "https://etherscan.io",
    infrastructure: ethereumInfrastructure, wrappedEth: pin(ethereum.contracts.wrappedEth), multicall3: pin(ethereum.contracts.multicall3),
    preparationLag: 2n, launchConfirmations: 64,
    publicRpcUrls: Object.freeze(["https://mainnet.gateway.tenderly.co", "https://ethereum-rpc.publicnode.com"]) }),
});

/** An absent chain belongs only to existing Robinhood bindings. Unknown networks never fall back. */
export function foundationChainProfile(chainId: number = FOUNDATION_CHAIN_ID): FoundationChainProfile {
  if (chainId !== 1 && chainId !== FOUNDATION_CHAIN_ID) throw new Error("This network does not support Module Mode.");
  return profiles[chainId];
}
export function foundationBindingChainId(binding: { chainId?: number }): FoundationChainId {
  return foundationChainProfile(binding.chainId).chainId;
}
/** Source validation compares this declared client network with the RPC's actual chain before spending. */
export function foundationClientProfile(client: Pick<PublicClient, "chain">): FoundationChainProfile {
  return foundationChainProfile(client.chain?.id);
}
