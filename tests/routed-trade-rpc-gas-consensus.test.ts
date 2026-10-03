import { describe, expect, it } from "vitest";
import { toHex } from "viem";
import { readAgreedTradeTraceV1, readTradeGasEstimateV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

const sender = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const transaction = { from: sender, to: recipient, input: "0x1234", value: "0x1" };
const frame = (gasUsed = 50_000n) => ({ type: "CALL", from: sender, to: recipient,
  input: "0x1234", output: "0x", value: "0x1", gasUsed: toHex(gasUsed) });
const rpc = (result: unknown): TradeRpcV1 => async () => result;

describe("independent provider gas consensus", () => {
  it("compares nested execution effects while retaining the actual primary trace and larger root gas", async () => {
    const primary = { ...frame(), calls: [frame(10_000n)] };
    const secondary = { ...frame(50_009n), calls: [frame(10_009n)] };
    const result = await readAgreedTradeTraceV1([rpc(primary), rpc(secondary)], transaction, "0x2a");
    expect(result.maximumGasUsed).toBe(50_009n);
    expect(result.trace.gasUsed).toBe("50000");
    expect(result.trace.calls[0].gasUsed).toBe("10000");
    expect(await readTradeGasEstimateV1([rpc("0xc350"), rpc("0xc359")], transaction, "0x2a")).toBe("50009");
  });

  it.each(["from", "to", "input", "output", "value", "error", "type", "calls"])("rejects a nested %s disagreement", async key => {
    const changes: Record<string, unknown> = { from: recipient, to: sender, input: "0x5678", output: "0xab", value: "0x2",
      error: "execution reverted", type: "STATICCALL", calls: [frame()] };
    await expect(readAgreedTradeTraceV1([rpc({ ...frame(), calls: [frame()] }),
      rpc({ ...frame(50_009n), calls: [{ ...frame(10_009n), [key]: changes[key] }] })], transaction, "0x2a"))
      .rejects.toMatchObject({ code: "TRADE_PROVIDER_DISAGREEMENT", status: 503 });
  });

  it("rejects invalid or unbounded gas from either provider", async () => {
    for (const estimate of ["0x0", toHex(30_000_001n), "-1", "0xinvalid"]) {
      await expect(readTradeGasEstimateV1([rpc("0xc350"), rpc(estimate)], transaction, "0x2a")).rejects.toThrow();
    }
    await expect(readAgreedTradeTraceV1([rpc(frame()), rpc({ ...frame(), calls: [frame(30_000_001n)] })], transaction, "0x2a"))
      .rejects.toMatchObject({ code: "TRADE_GAS_PENDING", status: 503 });
    const unavailable: TradeRpcV1 = async () => { throw Error("Unavailable"); };
    await expect(readAgreedTradeTraceV1([rpc(frame()), unavailable], transaction, "0x2a")).rejects.toThrow();
    await expect(readTradeGasEstimateV1([rpc("0xc350"), unavailable], transaction, "0x2a")).rejects.toThrow();
  });
});
