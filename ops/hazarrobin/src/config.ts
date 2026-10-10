import { defineChain, encodeFunctionData, parseAbi } from "viem";

export const CHAIN_ID = 4663;
export const CHAIN_HEX = "0x1237";
export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const FALLBACK_RPC_URL = "https://robinhood-rpc.publicnode.com";
export const EXPLORER_URL = "https://robinhoodchain.blockscout.com";

export const LOCKER = "0x9f9424BbCCe8a865f70155fe40Fb22A103eBEc63";
export const FEE_RECIPIENT = "0x39544A7023081B56D7405c1af0bFaf72da7e24F6";
export const TOKEN = "0xC60bA256B44334A0Cd2C7242E98B88f031abB006";
export const HOOK = "0x720e649549F7BC2118aCBA9F4C9ae6fCC7586080";
export const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
export const POSITION_MANAGER = "0x58daec3116aae6D93017bAAea7749052E8a04fA7";
export const STATE_VIEW = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b";
export const POOL_ID = "0x3df16f271060e4941c0386047def159f42e629dc0455db623c5b363eeacbcc1d";
export const TOKEN_ID = 1708785n;
export const TICK_LOWER = -887220;
export const TICK_UPPER = 887220;

export const EXPECTED_LOCKER_RUNTIME_HASH =
  "0x3c214df5f91d0a38c491b945127a0cbbfe5693796c5d5f363afd7d945b81a880";
export const EXPECTED_POSITION_MANAGER_RUNTIME_HASH =
  "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2";
export const EXPECTED_LIQUIDITY = 47277308323628491467511n;
export const EXPECTED_LP_FEE_PIPS = 10000n;
export const MAX_UINT256 = (1n << 256n) - 1n;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [RPC_URL, FALLBACK_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: EXPLORER_URL },
  },
  contracts: {
    multicall3: {
      address: MULTICALL3,
      blockCreated: 0,
    },
  },
});

export const lockerAbi = parseAbi([
  "function collectFees(uint256 tokenId)",
  "function feeRecipient() view returns (address)",
  "function positionManager() view returns (address)",
  "function operator() view returns (address)",
  "function timelockBlockNumber() view returns (uint256)",
  "event FeesForwarded(address indexed feeRecipient)",
]);

export const positionManagerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function subscriber(uint256 tokenId) view returns (address)",
  "function poolManager() view returns (address)",
]);

export const hookAbi = parseAbi([
  "function currentLPFeePips() view returns (uint24)",
]);

export const tokenAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

export const stateViewAbi = parseAbi([
  "function getPositionInfo(bytes32 poolId,address owner,int24 tickLower,int24 tickUpper,bytes32 salt) view returns (uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128)",
  "function getFeeGrowthInside(bytes32 poolId,int24 tickLower,int24 tickUpper) view returns (uint256 feeGrowthInside0X128,uint256 feeGrowthInside1X128)",
]);

export const CLAIM_CALLDATA = encodeFunctionData({
  abi: lockerAbi,
  functionName: "collectFees",
  args: [TOKEN_ID],
});

export const EXPECTED_CLAIM_CALLDATA =
  "0xb17acdcd00000000000000000000000000000000000000000000000000000000001a12f1";

export const CONTRACT_URL = `${EXPLORER_URL}/address/${LOCKER}?tab=read_write_contract`;
export const TOKEN_URL = `${EXPLORER_URL}/token/${TOKEN}`;
