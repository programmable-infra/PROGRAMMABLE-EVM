import { getAddress, type Address, type Hex, type PublicClient } from "viem";

export interface FoundationMinedCall { from: Address; to: Address; data: Hex; value: bigint }
type MinedTransaction = Pick<Awaited<ReturnType<PublicClient["getTransaction"]>>,
  "hash" | "from" | "to" | "input" | "value" | "blockNumber" | "blockHash" | "transactionIndex">;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const fail = (): never => { throw new Error("The successful launch call could not be verified in its mined transaction."); };
function frame(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function call(value: Record<string, unknown>): FoundationMinedCall {
  if (typeof value.from !== "string" || !/^0x[\da-f]{40}$/i.test(value.from)
    || typeof value.to !== "string" || !/^0x[\da-f]{40}$/i.test(value.to)
    || typeof value.input !== "string" || !/^0x(?:[\da-f]{2})*$/i.test(value.input)
    || value.input.length > 1_048_578
    || typeof value.value !== "string" || !/^0x[\da-f]{1,64}$/i.test(value.value)) return fail();
  return { from: getAddress(value.from), to: getAddress(value.to), data: value.input as Hex, value: BigInt(value.value) };
}

/** Select a committed CALL, never a delegatecall or a child of a reverted frame.
 * The caller still verifies the source, decoded settings, receipt events and pool. */
export function selectFoundationMinedCall(trace: unknown, transaction: MinedTransaction,
  expected: { account: Address; target: Address; accepts: (call: FoundationMinedCall) => boolean }): FoundationMinedCall {
  const root = frame(trace), outer = call(root);
  if (root.type !== "CALL" || root.error || !transaction.to || !same(outer.from, transaction.from)
    || !same(outer.to, transaction.to) || !same(outer.data, transaction.input) || outer.value !== transaction.value) return fail();
  const matches: FoundationMinedCall[] = [];
  let visited = 0;
  function visit(value: unknown, depth: number) {
    if (++visited > 2_048 || depth > 64) return fail();
    const item = frame(value);
    if (item.error) return;
    if (item.type === "CALL" && typeof item.from === "string" && typeof item.to === "string"
      && same(item.from, expected.account) && same(item.to, expected.target)) {
      const candidate = call(item);
      if (expected.accepts(candidate)) matches.push(candidate);
    }
    if (item.calls !== undefined) {
      if (!Array.isArray(item.calls)) return fail();
      for (const child of item.calls) visit(child, depth + 1);
    }
  }
  visit(root, 0);
  if (matches.length !== 1) return fail();
  return matches[0];
}

/** Direct wallet launches need no trace. Smart-wallet launches retain the outer
 * transaction identity while their actual caller, calldata and value come from execution. */
export async function readFoundationMinedCall(client: PublicClient, transaction: MinedTransaction,
  expected: { account: Address; target: Address; accepts: (call: FoundationMinedCall) => boolean }): Promise<FoundationMinedCall> {
  if (transaction.blockNumber === null || !transaction.blockHash || !transaction.to) return fail();
  if (same(transaction.from, expected.account) && same(transaction.to, expected.target)) {
    const direct = { from: getAddress(transaction.from), to: getAddress(transaction.to), data: transaction.input, value: transaction.value };
    if (!expected.accepts(direct)) return fail();
    return direct;
  }
  const [receipt, trace] = await Promise.all([
    client.getTransactionReceipt({ hash: transaction.hash }),
    client.request({ method: "debug_traceTransaction", params: [transaction.hash, { tracer: "callTracer", timeout: "10s" }] } as never) as Promise<unknown>,
  ]);
  if (receipt.status !== "success" || !same(receipt.transactionHash, transaction.hash)
    || receipt.blockNumber !== transaction.blockNumber || !same(receipt.blockHash, transaction.blockHash)
    || receipt.transactionIndex !== transaction.transactionIndex || !receipt.to
    || !same(receipt.from, transaction.from) || !same(receipt.to, transaction.to)) return fail();
  const selected = selectFoundationMinedCall(trace, transaction, expected);
  const block = await client.getBlock({ blockNumber: transaction.blockNumber });
  if (!block.hash || !same(block.hash, transaction.blockHash)) return fail();
  return selected;
}
