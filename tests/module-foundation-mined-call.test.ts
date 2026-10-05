import { describe, expect, it, vi } from "vitest";
import { getAddress, toHex, type PublicClient } from "viem";
import { readFoundationMinedCall, selectFoundationMinedCall } from "@/lib/module-foundation/mined-call";

const address = (n: number) => getAddress(toHex(n, { size: 20 }));
const hash = (n: number) => toHex(n, { size: 32 });
const account = address(1), target = address(2), bundler = address(3), entryPoint = address(4);
const expected = { account, target, accepts: (call: { data: string; value: bigint }) => call.data === "0x1234" && call.value === 7n };
const inner = () => ({ type: "CALL", from: account, to: target, input: "0x1234", value: "0x7" });
const transaction = { hash: hash(1), from: bundler, to: entryPoint, input: "0xabcd" as const, value: 0n,
  blockNumber: 100n, blockHash: hash(100), transactionIndex: 2 };
const trace = () => ({ type: "CALL", from: bundler, to: entryPoint, input: String(transaction.input), value: "0x0",
  calls: [{ type: "CALL", from: entryPoint, to: account, input: "0xaabb", value: "0x0", calls: [inner()] }] });
function client() {
  return { request: vi.fn(async () => trace()), getBlock: vi.fn(async () => ({ hash: transaction.blockHash })),
    getTransactionReceipt: vi.fn(async () => ({ status: "success", transactionHash: transaction.hash,
      from: bundler, to: entryPoint, blockNumber: transaction.blockNumber, blockHash: transaction.blockHash, transactionIndex: 2 })) };
}

describe("mined foundation calls", () => {
  it("reads a direct wallet call without requesting traces", async () => {
    const rpc = client();
    await expect(readFoundationMinedCall(rpc as unknown as PublicClient,
      { ...transaction, from: account, to: target, input: "0x1234", value: 7n }, expected))
      .resolves.toEqual({ from: account, to: target, data: "0x1234", value: 7n });
    expect(rpc.request).not.toHaveBeenCalled();
  });
  it("restores the smart wallet's caller and value, not the bundler's", async () => {
    const rpc = client();
    await expect(readFoundationMinedCall(rpc as unknown as PublicClient, transaction, expected))
      .resolves.toEqual({ from: account, to: target, data: "0x1234", value: 7n });
    expect(rpc.request).toHaveBeenCalledWith({ method: "debug_traceTransaction", params: [transaction.hash, { tracer: "callTracer", timeout: "10s" }] });
  });
  it.each(["from", "to", "input", "value"] as const)("rejects a trace with a different outer %s", field => {
    const value = trace();
    value[field] = field === "from" || field === "to" ? address(9) : field === "value" ? "0x1" : "0xffff";
    expect(() => selectFoundationMinedCall(value, transaction, expected)).toThrow();
  });
  it("rejects reverted ancestors and delegatecalls", () => {
    const failed = trace();
    Object.assign(failed.calls[0], { error: "execution reverted" });
    expect(() => selectFoundationMinedCall(failed, transaction, expected)).toThrow();
    const delegated = trace(); delegated.calls[0].calls[0].type = "DELEGATECALL";
    expect(() => selectFoundationMinedCall(delegated, transaction, expected)).toThrow();
  });
  it("ignores rolled-back attempts when one committed call matches", () => {
    const value = trace();
    value.calls.unshift({ ...value.calls[0], ...{ error: "reverted" } });
    expect(selectFoundationMinedCall(value, transaction, expected).from).toBe(account);
  });
  it("rejects missing, ambiguous and wrong-value calls", () => {
    const ambiguous = trace(); ambiguous.calls[0].calls.push(inner());
    expect(() => selectFoundationMinedCall(ambiguous, transaction, expected)).toThrow();
    const missing = trace(); missing.calls[0].calls = [];
    expect(() => selectFoundationMinedCall(missing, transaction, expected)).toThrow();
    const wrong = trace(); wrong.calls[0].calls[0].value = "0x8";
    expect(() => selectFoundationMinedCall(wrong, transaction, expected)).toThrow();
  });
  it("rejects malformed and unbounded traces", () => {
    const malformed = trace(); Object.assign(malformed.calls[0], { calls: {} });
    expect(() => selectFoundationMinedCall(malformed, transaction, expected)).toThrow();
    const excessive = trace(); excessive.calls[0].calls = Array.from({ length: 2_049 }, inner);
    expect(() => selectFoundationMinedCall(excessive, transaction, expected)).toThrow();
  });
  it.each(["status", "blockHash", "transactionHash", "from", "to", "transactionIndex"])("rejects a conflicting receipt %s", async field => {
    const rpc = client(), receipt = await rpc.getTransactionReceipt();
    Object.assign(receipt, { [field]: field === "status" ? "reverted" : field === "transactionIndex" ? 3 : field === "from" || field === "to" ? address(9) : hash(9) });
    rpc.getTransactionReceipt.mockResolvedValue(receipt);
    await expect(readFoundationMinedCall(rpc as unknown as PublicClient, transaction, expected)).rejects.toThrow();
  });
  it("rejects a reorg after trace verification", async () => {
    const rpc = client(); rpc.getBlock.mockResolvedValue({ hash: hash(101) });
    await expect(readFoundationMinedCall(rpc as unknown as PublicClient, transaction, expected)).rejects.toThrow();
  });
});
