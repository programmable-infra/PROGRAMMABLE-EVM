import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
import { discoverCodexLaunches } from "@/lib/server/codex-launch-discovery";
const hook = `0x${"aa".repeat(20)}`;
const row = (index: number) => ({ pair: {
  address: `0x${index.toString(16).padStart(64, "0")}`, networkId: 1,
  token0: `0x${"00".repeat(20)}`, token1: `0x${index.toString(16).padStart(40, "0")}`,
  createdAt: 100+index, protocolData: { uniswapV4HookAddress: hook },
  token0Data: null, token1Data: { createBlockNumber: index, createTransactionHash: `0x${"bb".repeat(32)}` },
} });
describe("Codex launch discovery", () => {
  it("continues past count=100 and pins the chain, hook and time boundary on every page", async () => {
    const read = vi.fn(async (_query: string, vars: Record<string, unknown>) => {
      const offset = vars.offset as number;
      return { filterPairs: { count: offset===0?100:2, offset,
        results: Array.from({length:offset===0?100:2},(_,i)=>row(offset+i+1)) } };
    });
    const result = await discoverCodexLaunches(1,[hook],1000,read);
    expect(result).toHaveLength(102);
    expect(read).toHaveBeenCalledTimes(2);
    for (const call of read.mock.calls) expect(call[1].filters).toEqual({network:[1],hookAddress:[hook],createdAt:{lte:1000}});
    expect(result[101].tokens[1].creationBlock).toBe(102);
  });
  it("fails a repeated page and provider identity mismatches instead of serving a partial catalog", async () => {
    for (const mutation of [
      (p: ReturnType<typeof row>["pair"])=>{p.networkId=4663;},
      (p: ReturnType<typeof row>["pair"])=>{p.protocolData.uniswapV4HookAddress=`0x${"cc".repeat(20)}`;},
      (p: ReturnType<typeof row>["pair"])=>{p.createdAt=1001;},
    ]) {
      const value=row(1);mutation(value.pair);
      await expect(discoverCodexLaunches(1,[hook],1000,async()=>({filterPairs:{count:1,offset:0,results:[value]}}))).rejects.toThrow();
    }
    await expect(discoverCodexLaunches(1,[hook],1000,async(_q,vars)=>({filterPairs:{count:100,offset:vars.offset,
      results:Array.from({length:100},(_,i)=>row(i+1))}}))).rejects.toThrow();
  });
  it("keeps a pool without trades or token-creation metadata discoverable", async () => {
    const value=row(1);value.pair.token1Data=null as unknown as typeof value.pair.token1Data;
    const [result] = await discoverCodexLaunches(1,[hook],1000,async()=>({filterPairs:{count:1,offset:0,results:[value]}}));
    expect(result.tokens[1].creationTransaction).toBeNull();
  });
});
