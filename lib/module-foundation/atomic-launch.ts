import { decodeFoundationEthereumTransaction } from "./ethereum-graph";
import { foundationCreatorFeeRates } from "./creator-fees";
import { decodeAbiParameters, decodeFunctionData, getAddress, keccak256, stringToHex, zeroAddress, type Hex, type PublicClient } from "viem";
import { encodeFoundationLaunchEntry, encodeFoundationParameters, type FoundationLaunchParameters } from "./abi";
import { foundationFactoryAbiFor, foundationFactoryNativeAbiFor, foundationFactoryVersion, type FoundationDeploymentBinding } from "./protocol";
import { foundationBindingChainId, foundationChainProfile } from "./chains";
import type { FoundationPoolKey } from "./route";

export const FOUNDATION_NATIVE_FUNDING_ID = keccak256(stringToHex("programmable.module-foundation.native-funding.v2"));
export const FOUNDATION_NO_FUNDING_POOL: FoundationPoolKey = { currency0: zeroAddress, currency1: zeroAddress, fee: 0, tickSpacing: 0, hooks: zeroAddress };
import { assertFoundationFundingPath, encodeFoundationFundingPath, foundationFundingPathParameters as fundingPathParameters } from "./funding-path";
export { assertFoundationFundingPath, encodeFoundationFundingPath, type FoundationFundingHop, type FoundationEthFunding } from "./funding-path";

export async function assertFoundationAtomicEth(client: PublicClient, binding: FoundationDeploymentBinding, blockNumber: bigint) {
  try {
    const { address: FOUNDATION_WETH, runtimeCodeHash: FOUNDATION_WETH_CODE_HASH } = foundationChainProfile(foundationBindingChainId(binding)).wrappedEth;
    if (foundationFactoryVersion(binding) === "v1") throw new Error("version");
    const abi = foundationFactoryNativeAbiFor(binding);
    const [id, weth, hash, code] = await Promise.all([
      client.readContract({ address: binding.factory.address, abi, functionName: "NATIVE_FUNDING_ID", blockNumber }),
      client.readContract({ address: binding.factory.address, abi, functionName: "wrappedEth", blockNumber }),
      client.readContract({ address: binding.factory.address, abi, functionName: "wrappedEthCodeHash", blockNumber }),
      client.getCode({ address: FOUNDATION_WETH, blockNumber }),
    ]);
    if (id !== FOUNDATION_NATIVE_FUNDING_ID || getAddress(weth) !== FOUNDATION_WETH || hash !== FOUNDATION_WETH_CODE_HASH
      || !code || keccak256(code) !== hash) throw new Error("binding");
  } catch { throw new Error("This launch version does not yet support ETH and the initial buy in one confirmation. The new launch contract must be activated first."); }
}

/** Exact calldata and value, shared by simulation, discovery and receipt verification. */
function decodeCall(binding: FoundationDeploymentBinding, transaction: { data: Hex; value: bigint }) {
  if (binding.ethereumGraph) return { parameters: decodeFoundationEthereumTransaction(transaction).parameters, native: true };
  const chainId = foundationBindingChainId(binding), FOUNDATION_WETH = foundationChainProfile(chainId).wrappedEth.address;
  const abi = foundationFactoryVersion(binding) !== "v1" ? foundationFactoryNativeAbiFor(binding) : foundationFactoryAbiFor(binding);
  const decoded = decodeFunctionData({ abi, data: transaction.data });
  let parameters: FoundationLaunchParameters;
  let native = false;
  let encoded: Hex;
  if (decoded.functionName === "launch") {
    if (transaction.value !== 0n) throw new Error("An ERC20 launch cannot accept ETH.");
    parameters = decoded.args[0];
    encoded = encodeFoundationLaunchEntry(parameters, { functionName: "launch" });
  } else if (decoded.functionName === "launchWithEthRoute" && foundationFactoryVersion(binding) !== "v1") {
    parameters = decoded.args[0]; native = true;
    const path = decodeAbiParameters(fundingPathParameters, decoded.args[1])[0], amount = parameters.initialBuyQuoteAmount + parameters.additionalQuoteAmount;
    if (encodeFoundationFundingPath(path).toLowerCase() !== decoded.args[1].toLowerCase()) throw new Error("The funding path is not canonical.");
    if (transaction.value < 0n || transaction.value > (1n << 127n) - 1n || (amount > 0n && transaction.value === 0n)) throw new Error("Invalid ETH funding budget.");
    if (amount > 0n) assertFoundationFundingPath(parameters.quote, path, chainId);
    if (getAddress(parameters.quote) === FOUNDATION_WETH && transaction.value < amount) throw new Error("Insufficient ETH funding.");
    encoded = encodeFoundationLaunchEntry(parameters, { functionName: "launchWithEthRoute", fundingPath: decoded.args[1] });
  } else if (decoded.functionName === "launchWithEth" && foundationFactoryVersion(binding) !== "v1") {
    // Preserve canonical decoding of launches made by the previous, immutable factory.
    parameters = decoded.args[0]; native = true;
    const pool = decoded.args[1], amount = parameters.initialBuyQuoteAmount + parameters.additionalQuoteAmount;
    if (transaction.value < 0n || transaction.value > (1n << 127n) - 1n || (amount > 0n && transaction.value === 0n)) throw new Error("Invalid ETH funding budget.");
    if (getAddress(parameters.quote) === FOUNDATION_WETH) {
      if (transaction.value < amount || JSON.stringify(pool) !== JSON.stringify(FOUNDATION_NO_FUNDING_POOL)) throw new Error("Invalid ETH funding pool.");
    } else if (amount > 0n && (BigInt(pool.currency0) >= BigInt(pool.currency1)
      || ![pool.currency0, pool.currency1].some(a => getAddress(a) === FOUNDATION_WETH)
      || ![pool.currency0, pool.currency1].some(a => getAddress(a) === getAddress(parameters.quote)))) throw new Error("The funding pool uses another asset.");
    encoded = encodeFoundationLaunchEntry(parameters, { functionName: "launchWithEth", fundingPool: pool });
  } else throw new Error("The transaction does not call foundation launch.");
  foundationCreatorFeeRates(parameters);
  if (encoded.toLowerCase() !== transaction.data.toLowerCase()) throw new Error("The launch calldata is not canonical.");
  return { parameters, native };
}

export function decodeFoundationLaunchCall(binding: FoundationDeploymentBinding, transaction: { data: Hex; value: bigint }) {
  try { return decodeCall(binding, transaction); }
  catch { throw new Error("The launch calldata does not call the selected foundation factory with the canonical ABI encoding or ETH value."); }
}

export function assertFoundationLaunchCall(binding: FoundationDeploymentBinding, transaction: { data: Hex; value: bigint }, expected: FoundationLaunchParameters) {
  const call = decodeFoundationLaunchCall(binding, transaction);
  if ((foundationFactoryVersion(binding) === "v3") !== (expected.creatorFeeBps === undefined)) throw new Error("The creator fee fields do not match the selected factory version.");
  foundationCreatorFeeRates(expected);
  if (encodeFoundationParameters(call.parameters).toLowerCase() !== encodeFoundationParameters(expected).toLowerCase()) {
    throw new Error("The launch calldata differs from the coin settings.");
  }
  return call;
}
