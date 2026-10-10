import { formatUnits, getAddress, type Address, type Hex } from "viem";
import {
  EXPECTED_LIQUIDITY,
  EXPECTED_LOCKER_RUNTIME_HASH,
  EXPECTED_LP_FEE_PIPS,
  EXPECTED_POSITION_MANAGER_RUNTIME_HASH,
  FEE_RECIPIENT,
  LOCKER,
  MAX_UINT256,
  POOL_MANAGER,
  POSITION_MANAGER,
  ZERO_ADDRESS,
} from "./config";

const Q128 = 1n << 128n;
const UINT256_MODULUS = 1n << 256n;

export interface ContractCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface SnapshotFacts {
  lockerRuntimeHash: Hex;
  positionManagerRuntimeHash: Hex;
  feeRecipient: Address;
  positionManager: Address;
  operator: Address;
  timelockBlockNumber: bigint;
  owner: Address;
  approved: Address;
  subscriber: Address;
  liquidity: bigint;
  stateLiquidity: bigint;
  linkedPoolManager: Address;
  lpFeePips: bigint;
}

export function subtractUint256(current: bigint, previous: bigint): bigint {
  return current >= previous
    ? current - previous
    : UINT256_MODULUS - previous + current;
}

export function calculateFeesOwed(
  currentGrowth: bigint,
  lastGrowth: bigint,
  liquidity: bigint,
): bigint {
  return (subtractUint256(currentGrowth, lastGrowth) * liquidity) / Q128;
}

export function validateSnapshot(facts: SnapshotFacts): ContractCheck[] {
  return [
    {
      id: "locker-code",
      label: "Locker Bytecode",
      passed: facts.lockerRuntimeHash.toLowerCase() === EXPECTED_LOCKER_RUNTIME_HASH,
      detail: "Exakter veröffentlichter Runtime Hash",
    },
    {
      id: "position-manager-code",
      label: "PositionManager Bytecode",
      passed:
        facts.positionManagerRuntimeHash.toLowerCase() ===
        EXPECTED_POSITION_MANAGER_RUNTIME_HASH,
      detail: "Exakte Uniswap Infrastruktur",
    },
    {
      id: "recipient",
      label: "Fee Empfänger",
      passed: addressesEqual(facts.feeRecipient, FEE_RECIPIENT),
      detail: shortAddress(FEE_RECIPIENT),
    },
    {
      id: "position-manager",
      label: "PositionManager",
      passed: addressesEqual(facts.positionManager, POSITION_MANAGER),
      detail: shortAddress(POSITION_MANAGER),
    },
    {
      id: "operator",
      label: "Operator",
      passed: addressesEqual(facts.operator, ZERO_ADDRESS),
      detail: "Dauerhaft null",
    },
    {
      id: "timelock",
      label: "Freigabeblock",
      passed: facts.timelockBlockNumber === MAX_UINT256,
      detail: "Maximalwert",
    },
    {
      id: "owner",
      label: "LP NFT Eigentümer",
      passed: addressesEqual(facts.owner, LOCKER),
      detail: `Locker besitzt Position 1708785`,
    },
    {
      id: "approval",
      label: "NFT Freigabe",
      passed: addressesEqual(facts.approved, ZERO_ADDRESS),
      detail: "Keine Freigabe",
    },
    {
      id: "subscriber",
      label: "Position Subscriber",
      passed: addressesEqual(facts.subscriber, ZERO_ADDRESS),
      detail: "Keiner gesetzt",
    },
    {
      id: "liquidity",
      label: "Gesperrte Liquidität",
      passed:
        facts.liquidity === EXPECTED_LIQUIDITY &&
        facts.stateLiquidity === EXPECTED_LIQUIDITY,
      detail: "Principal unverändert",
    },
    {
      id: "pool-manager",
      label: "PoolManager Verbindung",
      passed: addressesEqual(facts.linkedPoolManager, POOL_MANAGER),
      detail: shortAddress(POOL_MANAGER),
    },
    {
      id: "lp-fee",
      label: "Aktuelle LP Fee",
      passed: facts.lpFeePips === EXPECTED_LP_FEE_PIPS,
      detail: "1 Prozent",
    },
  ];
}

export function addressesEqual(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

export function shortAddress(address: string): string {
  if (address.length < 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function formatAssetAmount(
  value: bigint,
  fractionDigits: number,
  decimals = 18,
): string {
  const [whole = "0", fraction = ""] = formatUnits(value, decimals).split(".");
  const grouped = new Intl.NumberFormat("de-CH", {
    maximumFractionDigits: 0,
  }).format(BigInt(whole));
  const trimmed = fraction.slice(0, fractionDigits).replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}
