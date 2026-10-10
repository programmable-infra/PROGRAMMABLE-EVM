import { afterEach, expect, it, vi } from "vitest";
import { launchProjectionSourceV1 } from "@/lib/server/robinhood-index/launch-projection-source";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("retries one transient projection-feed 503 without changing the cursor", async () => {
  vi.stubEnv("ROBINHOOD_RPC_URL", "https://primary.example");
  vi.stubEnv("ROBINHOOD_RPC_SECONDARY_URL", "https://secondary.example");
  const fetchPage = vi.fn()
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ schemaVersion: "programmable.launch-projection-page.v1", launches: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetchPage);

  await expect(launchProjectionSourceV1().page(null)).resolves.toEqual({ launches: [], nextCursor: null });
  expect(fetchPage).toHaveBeenCalledTimes(2);
  expect(fetchPage.mock.calls[0][0].toString()).toBe(fetchPage.mock.calls[1][0].toString());
});

it("continues through an empty candidate page but rejects a repeated cursor", async () => {
  vi.stubEnv("ROBINHOOD_RPC_URL", "https://primary.example");
  vi.stubEnv("ROBINHOOD_RPC_SECONDARY_URL", "https://secondary.example");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({
    schemaVersion: "programmable.launch-projection-page.v1", launches: [], nextCursor: "next-page",
  }))));
  await expect(launchProjectionSourceV1().page("previous-page"))
    .resolves.toEqual({ launches: [], nextCursor: "next-page" });
  await expect(launchProjectionSourceV1().page("next-page")).rejects.toThrow("Invalid projection page");
});
