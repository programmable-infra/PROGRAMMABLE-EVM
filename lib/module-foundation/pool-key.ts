import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import { FOUNDATION_LP_FEE, FOUNDATION_TICK_SPACING } from "./constants";

export interface FoundationPoolKey { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
export interface FoundationPool { token: Address; quote: Address; hook: Address; poolId: Hex }

export function foundationPoolKey(pool: Omit<FoundationPool, "poolId">): FoundationPoolKey {
  const token = getAddress(pool.token), quote = getAddress(pool.quote), hook = getAddress(pool.hook);
  if (BigInt(token) === 0n || BigInt(quote) === 0n || BigInt(hook) === 0n || token === quote || token === hook || quote === hook) throw new Error("Invalid launch pool identity.");
  return { currency0: BigInt(token) < BigInt(quote) ? token : quote,
    currency1: BigInt(token) < BigInt(quote) ? quote : token, fee: FOUNDATION_LP_FEE,
    tickSpacing: FOUNDATION_TICK_SPACING, hooks: hook };
}

export function foundationPoolId(key: FoundationPoolKey): Hex {
  if (BigInt(key.currency0) >= BigInt(key.currency1)) throw new Error("Pool currencies must be ordered.");
  return keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"),
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
}
