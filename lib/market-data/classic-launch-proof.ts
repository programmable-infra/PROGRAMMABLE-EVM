import { decodeEventLog, getAddress, isAddress, parseAbi, type Hex } from "viem";
import config from "../../config/classic-launch-catalog.v1.json";
import type { LauncherToken } from "../tokens";

export const classicLaunchEvents = parseAbi([
  "event MemeTokenLaunchedV2(address indexed deployer,address indexed token,bytes32 indexed poolId,address feeHook,address rewardVault,address positionRecipient,uint256 positionTokenId,uint16 buySwapFeeBps,uint16 sellSwapFeeBps,bytes32 rewardConfigurationHash,bytes32 launchHash)",
  "event MemeLiquidityConfiguredV2(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
  "event MemeCreatorInitialBuyV2(address indexed deployer,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
  "event MemeCreatorInitialBuyCustodyV2(address indexed deployer,address indexed token,address indexed custody,uint8 mode,uint16 durationDays,uint16 cliffDays,bytes32 configurationHash,bytes32 launchHash)",
]);
export const classicV2Events = parseAbi([
  "event MemeTokenLaunched(address indexed creator,address indexed token,bytes32 indexed poolId,address feeHook,address positionRecipient,uint256 positionTokenId,uint16 totalSwapFeeBps,bytes32 launchHash)",
  "event MemeLiquidityConfigured(address indexed token,uint256 totalSupply,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,int24 initialTick,int24 tickLower,int24 tickUpper,uint24 lpFeePips,bytes32 launchHash)",
  "event MemeCreatorInitialBuy(address indexed creator,address indexed token,bytes32 indexed poolId,uint256 nativeAmount,uint256 tokenAmount,bytes32 launchHash)",
]);
export const CLASSIC_MAIN_TOKEN = "0x7987f03462200b3d8a072e02c89a8a41dcb124ee";
export type ClassicRawLog = {
  address: string; blockNumber: string; blockHash: string;
  transactionHash: string; transactionIndex: number; logIndex: number;
  data: string; topics: string[]; removed: boolean;
};
type Event = { log: ClassicRawLog; name: string; args: Record<string, string | number | bigint> };
export type ClassicLaunchProof = Omit<LauncherToken, "name" | "symbol" | "totalSupply" | "launchedAt"> & {
  launchBlockHash: Hex;
  launcherAddress: Hex;
  custody?: { mode: number; durationDays: number; cliffDays: number; address: Hex; configurationHash: Hex };
};
const hash = /^0x[0-9a-f]{64}$/i;
const zero = "0x0000000000000000000000000000000000000000";
function fail(): never { throw new Error("Classic launch evidence is inconsistent"); }
const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
function text(value: unknown): string { if (typeof value !== "string") fail(); return value; }
function addr(value: unknown): Hex { const result=text(value); if (!isAddress(result)) fail(); return getAddress(result); }
function uint(value: unknown): string {
  if (typeof value !== "bigint" && typeof value !== "number") fail();
  if (typeof value === "number" && !Number.isSafeInteger(value) || BigInt(value) < 0n) fail();
  return String(value);
}

/** A market provider's token record alone never grants launch or claim authority. */
export function parseClassicLaunchLogs(logs: readonly ClassicRawLog[]): ClassicLaunchProof[] {
  if (logs.length > 20_000) fail();
  const groups = new Map<string, Event[]>(), occurrences = new Set<string>();
  for (const log of logs) {
    const source = config.sources.find(source => same(source.launcher, log.address));
    if (!source || log.removed || !hash.test(log.blockHash) || !hash.test(log.transactionHash)
      || !/^\d+$/.test(log.blockNumber) || BigInt(log.blockNumber) < BigInt(source.startBlock)
      || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0
      || !Number.isSafeInteger(log.transactionIndex) || log.transactionIndex < 0) fail();
    const occurrence = `${log.blockHash}:${log.logIndex}`.toLowerCase();
    if (occurrences.has(occurrence)) fail(); occurrences.add(occurrence);
    const decoded = decodeEventLog({ abi: source.version === "classic-v2" ? classicV2Events : classicLaunchEvents,
      data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]], strict: true });
    const args = decoded.args as Record<string, string | number | bigint>;
    if (source.version === "classic-v2" && !same(args.token, CLASSIC_MAIN_TOKEN)) fail();
    const key = `${log.transactionHash}:${addr(args.token)}`.toLowerCase();
    const group = groups.get(key) ?? [];
    group.push({ log, name: decoded.eventName, args }); groups.set(key, group);
  }
  const tokens = new Set<string>(), pools = new Set<string>();
  return [...groups.values()].map(group => {
    const first = group[0]!.log;
    const source = config.sources.find(source => same(source.launcher, first.address))!;
    const v2 = source.version === "classic-v2", suffix = v2 ? "" : "V2";
    if (group.length !== (v2 ? 3 : 4) || new Set(group.map(event=>event.name)).size !== group.length) fail();
    const event = (name: string) => group.find(event => event.name === name+suffix) ?? fail();
    const launch = event("MemeTokenLaunched"), liquidity = event("MemeLiquidityConfigured"), buy = event("MemeCreatorInitialBuy");
    const a=launch.args, l=liquidity.args, b=buy.args;
    const creator=addr(a[v2 ? "creator" : "deployer"]), token=addr(a.token), pool=text(a.poolId);
    if (!hash.test(pool) || !hash.test(text(a.launchHash)) || !same(a.feeHook, source.hook)
      || !same(b[v2 ? "creator" : "deployer"], creator) || !same(b.poolId, pool)
      || BigInt(uint(b.nativeAmount)) === 0n || BigInt(uint(b.tokenAmount)) === 0n
      || BigInt(uint(l.totalSupply)) === 0n || Number(l.lpFeePips) !== 0
      || Number(l.tickLower) >= Number(l.tickUpper)) fail();
    for (const entry of group) {
      if (!same(entry.log.address, first.address) || !same(entry.log.blockHash, first.blockHash)
        || entry.log.blockNumber !== first.blockNumber || entry.log.transactionIndex !== first.transactionIndex
        || !same(entry.args.launchHash, a.launchHash) || !same(entry.args.token, token)) fail();
    }
    if (tokens.has(token.toLowerCase()) || pools.has(pool.toLowerCase())) fail();
    tokens.add(token.toLowerCase()); pools.add(pool.toLowerCase());
    const buyFee=Number(v2?a.totalSwapFeeBps:a.buySwapFeeBps), sellFee=Number(v2?a.totalSwapFeeBps:a.sellSwapFeeBps);
    if (![buyFee,sellFee].every(fee=>Number.isInteger(fee) && fee>=10 && fee<=1000)) fail();
    let custody: ClassicLaunchProof["custody"];
    if (!v2) {
      const c=event("MemeCreatorInitialBuyCustody").args;
      const mode=Number(c.mode), durationDays=Number(c.durationDays), cliffDays=Number(c.cliffDays), address=addr(c.custody);
      if (!same(c.deployer, creator) || ![0,1,2,3].includes(mode) || cliffDays>durationDays
        || mode===0 && (address!==zero || durationDays!==0 || cliffDays!==0)
        || mode!==0 && (address===zero || durationDays===0) || !hash.test(text(c.configurationHash))) fail();
      custody={mode,durationDays,cliffDays,address,configurationHash:c.configurationHash as Hex};
    }
    return {
      id:`1:${token.toLowerCase()}`, tokenAddress:token, creatorAddress:creator,
      launcherAddress:getAddress(source.launcher), hookAddress:getAddress(source.hook), poolId:pool as Hex,
      ...(v2?{}:{rewardVaultAddress:addr(a.rewardVault)}), positionRecipient:addr(a.positionRecipient), positionTokenId:uint(a.positionTokenId),
      launchHash:a.launchHash as Hex, launchBlockNumber:first.blockNumber, launchBlockHash:first.blockHash as Hex,
      launchTransactionHash:first.transactionHash as Hex, launchTransactionIndex:first.transactionIndex, launchLogIndex:launch.log.logIndex,
      totalSupplyRaw:uint(l.totalSupply), tokenLiquidityAmountRaw:uint(l.tokenLiquidityAmount), lockedTokenDustRaw:uint(l.lockedTokenDust),
      initialBuyEthAmountWei:uint(b.nativeAmount), initialBuyTokenAmountRaw:uint(b.tokenAmount),
      quoteAssetAddress:zero,quoteAssetSymbol:"ETH",quoteAssetName:"Ether",buyHookFeeBps:buyFee,sellHookFeeBps:sellFee,totalSwapFeeBps:Math.max(buyFee,sellFee),
      initialTick:Number(l.initialTick),tickLower:Number(l.tickLower),tickUpper:Number(l.tickUpper),lpFeePips:Number(l.lpFeePips),
      launchModel:"classic",launchModelVersion:source.version as "classic-v2"|"classic-v3"|"classic-v4",liquidityPath:"meme", ...(custody?{custody}:{}),
    };
  });
}
