import type { Address, Hex } from "viem";

export interface ExecutionTarget {
  id: string; kind: "strategy" | "rewards"; family: string; host: Address; module: Address;
  index: number; runtimeHash: Hex; configurationHash: Hex; deployedBlock: string; deploymentBlockHash?: Hex;
}
export interface ExecutionConfig {
  chainId: 1 | 4663; confirmations: number; rpcEnv: string; secondaryRpcEnv?: string; keyEnv: string;
  simulationAccount: Address; maxFeePerGasWei: string; maxGasSpendPerDayWei: string; targets: ExecutionTarget[];
}
export function validateExecutionConfig(config: unknown): ExecutionConfig;
