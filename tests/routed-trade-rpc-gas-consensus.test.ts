import { describe, expect, it, vi } from "vitest";
import { toHex } from "viem";
import { readAgreedTradeTraceV1, readTradeGasEstimateV1, readTradePostStateCallV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

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

describe("Nitro post-state reads", () => {
  const system = "0xa4b05fffffffffffffffffffffffffffffffffff";
  const slot = `0x${"ab".repeat(32)}`;
  const reference = { blockHash: `0x${"cd".repeat(32)}` as const, requireCanonical: true as const };
  const call = { from: sender, to: recipient, data: "0x1234" } as const;
  const post = { [system]: { stateDiff: { [slot]: toHex(42n, { size: 32 }) } },
    [recipient]: { stateDiff: { [slot]: toHex(100n, { size: 32 }) } } };
  const readFrame = { ...frame(), value: "0x0", output: toHex(100n, { size: 32 }) };

  it("preserves the complete evidence while replaying application state with two bound, gas-limited read traces", async () => {
    const original = structuredClone(post), primary = vi.fn(rpc(readFrame)), secondary = vi.fn(rpc({ ...readFrame, gasUsed: "0xc359" }));
    expect(await readTradePostStateCallV1([primary, secondary], call, "0x2a", reference, post)).toBe(readFrame.output);
    expect(post).toEqual(original);
    for (const read of [primary, secondary]) expect(read).toHaveBeenCalledExactlyOnceWith("debug_traceCall", [
      { ...call, value: "0x0", gas: "0x1e8480" }, "0x2a",
      { tracer: "callTracer", timeout: "10s", stateOverrides: { [recipient]: post[recipient] } },
    ]);
  });

  it.each([system, "0x000000000000000000000000000000000000006c"])("rejects even a caught nested read of protected system address %s", async to => {
    const trace = { ...readFrame, calls: [{ ...readFrame, to, error: "execution reverted" }] };
    await expect(readTradePostStateCallV1([rpc(trace), rpc(trace)], call, "0x2a", reference, post))
      .rejects.toMatchObject({ code: "POST_STATE_READ_ADAPTER_PENDING", status: 503 });
  });

  it("rejects disagreed output and substituted root bindings", async () => {
    await expect(readTradePostStateCallV1([rpc(readFrame), rpc({ ...readFrame, output: "0x" })], call, "0x2a", reference, post))
      .rejects.toMatchObject({ code: "TRADE_PROVIDER_DISAGREEMENT" });
    for (const patch of [{ from: recipient }, { to: sender }, { input: "0xabcd" }, { value: "0x1" }, { type: "STATICCALL" }, { error: "execution reverted" }, { gasUsed: toHex(2_000_001n) }]) {
      const changed = { ...readFrame, ...patch };
      await expect(readTradePostStateCallV1([rpc(changed), rpc(changed)], call, "0x2a", reference, post))
        .rejects.toMatchObject({ code: "POST_STATE_READ_ADAPTER_PENDING" });
    }
  });

  it("keeps ordinary post-state calls pinned to their canonical block hash", async () => {
    const overrides = { [recipient]: post[recipient] }, primary = vi.fn(rpc(readFrame.output)), secondary = vi.fn(rpc(readFrame.output));
    expect(await readTradePostStateCallV1([primary, secondary], call, "0x2a", reference, overrides)).toBe(readFrame.output);
    for (const read of [primary, secondary]) expect(read).toHaveBeenCalledExactlyOnceWith("eth_call", [call, reference, overrides]);
  });
});
