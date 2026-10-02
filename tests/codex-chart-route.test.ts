import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ chart: vi.fn(), robinhood: vi.fn(), ethereum: vi.fn() }));
vi.mock("@/lib/server/codex-market", () => ({ readCodexChart: mocks.chart }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodToken: mocks.robinhood }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumExploreCatalog: mocks.ethereum }));
import { GET } from "@/app/api/market/chart/route";
const address = `0x${"ab".repeat(20)}`;
afterEach(() => vi.resetAllMocks());
it.each(["token=bad", `token=${address}&range=all`, `token=${address}&chain=10`, `token=${address}&query=arbitrary`])("rejects invalid chart inputs without provider calls: %s", async query => {
  expect((await GET(new Request(`https://example.com/api/market/chart?${query}`))).status).toBe(400);
  expect(mocks.chart).not.toHaveBeenCalled();
});
describe("verified chart identity", () => {
  it("does not request Codex for an address outside either launch index", async () => {
    mocks.robinhood.mockResolvedValue({ token: null }); mocks.ethereum.mockResolvedValue({ entries: [] });
    for (const chain of [1,4663]) expect((await GET(new Request(`https://example.com/api/market/chart?token=${address}&chain=${chain}`))).status).toBe(404);
    expect(mocks.chart).not.toHaveBeenCalled();
  });
  it("returns bounded cacheable chart data and hides provider failures", async () => {
    mocks.robinhood.mockResolvedValue({ token: { tokenAddress: address } });
    mocks.chart.mockResolvedValue({ tokenAddress: address, chainId: 4663, range: "1D", source: "codex", points: [] });
    const url = `https://example.com/api/market/chart?token=${address}`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("s-maxage=15");
    mocks.chart.mockRejectedValue(new Error("private provider response"));
    const failed = await GET(new Request(url));
    expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain("private provider response");
  });
});
