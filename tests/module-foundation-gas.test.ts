import { describe, expect, it } from "vitest";
import { ETHEREUM_TRANSACTION_GAS_CAP as cap, foundationTransactionGasLimit } from "@/lib/module-foundation/gas";

describe("Foundation transaction gas limits", () => {
  it("keeps the existing buffer for Robinhood and ordinary Ethereum estimates", () => {
    expect(foundationTransactionGasLimit(1_000_000n)).toBe(1_215_000n);
    expect(foundationTransactionGasLimit(1_000_000n, 1)).toBe(1_215_000n);
    expect(foundationTransactionGasLimit(cap, 4663)).toBeGreaterThan(cap);
  });
  it("does not turn a valid Ethereum estimate into an invalid gas-limit field", () => {
    expect(foundationTransactionGasLimit(15_000_000n, 1)).toBe(cap);
    expect(foundationTransactionGasLimit(cap, 1)).toBe(cap);
    expect(() => foundationTransactionGasLimit(cap + 1n, 1)).toThrow("exceeds Ethereum");
    expect(() => foundationTransactionGasLimit(0n, 1)).toThrow("could not be estimated");
  });
});
