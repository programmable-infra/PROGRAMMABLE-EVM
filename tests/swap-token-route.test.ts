import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSwapToken } from "@/lib/server/swap/token";
import { LaunchPlanTradeErrorV1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { GET } from "@/app/api/swap/token/route";

vi.mock("@/lib/server/swap/token", () => ({ resolveSwapToken: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
const address = "0x1111111111111111111111111111111111111111";
const request = () => new Request(`https://programmable.market/api/swap/token?chain=4663&address=${address}`);

describe("swap route failure diagnostics", () => {
  it("preserves provider disagreement so the client does not treat it as a transient outage", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(resolveSwapToken).mockRejectedValue(new LaunchPlanTradeErrorV1("TRADE_PROVIDER_DISAGREEMENT", "Try again", 503));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "TRADE_PROVIDER_DISAGREEMENT", error: "Try again" });
    expect(log).toHaveBeenCalledWith("swap-token-lookup-failed", { chainId: 4663, token: address, code: "TRADE_PROVIDER_DISAGREEMENT" });
  });
  it("never exposes raw provider errors or credential URLs", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(resolveSwapToken).mockRejectedValue(new Error("https://provider.invalid/secret-token failed"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("ROUTE_UNAVAILABLE");
    expect(body + JSON.stringify(log.mock.calls)).not.toMatch(/secret-token|provider\.invalid/);
  });
});
