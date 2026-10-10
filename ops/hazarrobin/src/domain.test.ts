import { describe, expect, it } from "vitest";
import {
  CLAIM_CALLDATA,
  EXPECTED_CLAIM_CALLDATA,
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
import {
  calculateFeesOwed,
  formatAssetAmount,
  subtractUint256,
  validateSnapshot,
} from "./domain";

describe("claim binding", () => {
  it("encodes only collectFees for position 1708785", () => {
    expect(CLAIM_CALLDATA).toBe(EXPECTED_CLAIM_CALLDATA);
  });

  it("requires every immutable and custody invariant", () => {
    const checks = validateSnapshot({
      lockerRuntimeHash: EXPECTED_LOCKER_RUNTIME_HASH,
      positionManagerRuntimeHash: EXPECTED_POSITION_MANAGER_RUNTIME_HASH,
      feeRecipient: FEE_RECIPIENT,
      positionManager: POSITION_MANAGER,
      operator: ZERO_ADDRESS,
      timelockBlockNumber: MAX_UINT256,
      owner: LOCKER,
      approved: ZERO_ADDRESS,
      subscriber: ZERO_ADDRESS,
      liquidity: EXPECTED_LIQUIDITY,
      stateLiquidity: EXPECTED_LIQUIDITY,
      linkedPoolManager: POOL_MANAGER,
      lpFeePips: EXPECTED_LP_FEE_PIPS,
    });
    expect(checks).toHaveLength(12);
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("fails closed when the recipient changes", () => {
    const checks = validateSnapshot({
      lockerRuntimeHash: EXPECTED_LOCKER_RUNTIME_HASH,
      positionManagerRuntimeHash: EXPECTED_POSITION_MANAGER_RUNTIME_HASH,
      feeRecipient: ZERO_ADDRESS,
      positionManager: POSITION_MANAGER,
      operator: ZERO_ADDRESS,
      timelockBlockNumber: MAX_UINT256,
      owner: LOCKER,
      approved: ZERO_ADDRESS,
      subscriber: ZERO_ADDRESS,
      liquidity: EXPECTED_LIQUIDITY,
      stateLiquidity: EXPECTED_LIQUIDITY,
      linkedPoolManager: POOL_MANAGER,
      lpFeePips: EXPECTED_LP_FEE_PIPS,
    });
    expect(checks.find((check) => check.id === "recipient")?.passed).toBe(false);
  });
});

describe("v4 fee math", () => {
  it("calculates Q128 growth", () => {
    const q128 = 1n << 128n;
    expect(calculateFeesOwed(q128 * 2n, q128, 15n)).toBe(15n);
  });

  it("handles uint256 growth wraparound", () => {
    const max = (1n << 256n) - 1n;
    expect(subtractUint256(4n, max - 2n)).toBe(7n);
  });
});

describe("amount formatting", () => {
  it("keeps asset precision without scientific notation", () => {
    expect(formatAssetAmount(41713575447801379n, 6)).toBe("0.041713");
    expect(formatAssetAmount(72126305723401124016954n, 2)).toBe("72'126.3");
  });
});
