export { buildFoundationEthereumGraph, predictFoundationEthereumAccounts } from "../../../lib/module-foundation/ethereum-graph-builder";
export { simulateFoundationEthereumGraph } from "../../../lib/module-foundation/ethereum-graph-simulation";
export { encodeFoundationEthereumStamp } from "../../../lib/module-foundation/ethereum-graph-plan";
import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import { foundationLaunchParametersV3, type FoundationLaunchParametersV3 } from "../../../lib/module-foundation/abi";

export function decodeEthereumModuleParameters(bytes: Hex): FoundationLaunchParametersV3 {
  if (!/^0x(?:[\da-f]{2})+$/i.test(bytes) || bytes.length > 65_538) throw new Error("Invalid module parameter bytes.");
  const [parameters] = decodeAbiParameters(foundationLaunchParametersV3, bytes);
  if (encodeAbiParameters(foundationLaunchParametersV3, [parameters]).toLowerCase() !== bytes.toLowerCase()) {
    throw new Error("Module parameters are not canonically encoded.");
  }
  return parameters;
}
