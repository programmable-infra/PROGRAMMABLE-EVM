import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { verify, save } = vi.hoisted(() => ({ verify: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/server/module-foundation/confirmed-launch", () => ({ confirmFoundationLaunch: verify }));
vi.mock("@/lib/server/module-foundation/recent-launch-store", () => ({ saveRecentFoundationLaunch: save }));
const token = `0x${"12".repeat(20)}`, transactionHash = `0x${"34".repeat(32)}`;
const body = { chainId: 1, token, transactionHash };
const request = (data: unknown, origin?: string) => new Request("https://programmable.market/api/module-foundation/confirmed", {
  method: "POST", body: JSON.stringify(data), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
});
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); save.mockResolvedValue(undefined); });
describe("confirmed launch hint", () => {
  it("coalesces duplicate hints and stores only server-verified data", async () => {
    const { POST } = await import("@/app/api/module-foundation/confirmed/route");
    const check = Promise.withResolvers<object>();
    verify.mockReturnValue(check.promise);
    const first = POST(request(body)), second = POST(request(body));
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(save).not.toHaveBeenCalled();
    const record = { verified: true };
    check.resolve(record);
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(save).toHaveBeenCalledExactlyOnceWith(record);
    await POST(request(body));
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it("does not publish a failed receipt and does not expose RPC errors", async () => {
    const { POST } = await import("@/app/api/module-foundation/confirmed/route");
    verify.mockRejectedValue(new Error("private RPC credentials"));
    const result = await POST(request(body));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("credentials");
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects cross-site and oversized or malformed hints before any RPC", async () => {
    const { POST } = await import("@/app/api/module-foundation/confirmed/route");
    expect((await POST(request(body, "https://elsewhere.test"))).status).toBe(403);
    for (const invalid of [{ ...body, chainId: 2 }, { ...body, symbol: "FAKE" }, { ...body, transactionHash: "0x00" }, "x".repeat(600)]) {
      expect((await POST(request(invalid))).status).toBe(400);
    }
    expect(verify).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
