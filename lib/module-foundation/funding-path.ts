import { encodeAbiParameters, getAddress, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import { foundationChainProfile, type FoundationChainId } from "./chains";

/** Uniswap exact-output paths use each hop's input currency, in forward pool order. */
export interface FoundationFundingHop { intermediateCurrency: Address; fee: number; tickSpacing: number; hooks: Address; hookData: Hex }
export interface FoundationEthFunding { maximumEth: bigint; quoteAmount: bigint; path: readonly FoundationFundingHop[] }
export const foundationFundingPathParameters = parseAbiParameters("(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[]");
export function encodeFoundationFundingPath(path: readonly FoundationFundingHop[], chainId: FoundationChainId = 4663) {
  foundationChainProfile(chainId);
  return encodeAbiParameters(foundationFundingPathParameters, [path]);
}

export function assertFoundationFundingPath(quote: Address, path: readonly FoundationFundingHop[], chainId: FoundationChainId = 4663) {
  const FOUNDATION_WETH = foundationChainProfile(chainId).wrappedEth.address;
  if (getAddress(quote) === FOUNDATION_WETH) {
    if (path.length !== 0) throw new Error("WETH funding requires an empty path.");
    return;
  }
  if (path.length < 1 || path.length > 4 || getAddress(path[0].intermediateCurrency) !== zeroAddress) throw new Error("The funding path must start with native ETH.");
  const currencies = [...path.map(hop => getAddress(hop.intermediateCurrency)), getAddress(quote)];
  if (new Set(currencies).size !== currencies.length) throw new Error("The funding path must not repeat a currency.");
  for (const hop of path) {
    getAddress(hop.hooks);
    if (!Number.isInteger(hop.fee) || hop.fee < 0 || (hop.fee > 1_000_000 && hop.fee !== 0x800000)
      || !Number.isInteger(hop.tickSpacing) || hop.tickSpacing < 1 || hop.tickSpacing > 32_767
      || !/^0x(?:[0-9a-f]{2}){0,2048}$/i.test(hop.hookData)) throw new Error("Invalid Uniswap funding path.");
  }
}
