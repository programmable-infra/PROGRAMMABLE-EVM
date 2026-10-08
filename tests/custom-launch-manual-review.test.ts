import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";
import { createManualReviewBridgeV1 } from "../lib/server/custom-launch/manual-review-bridge-v1";
import { customLaunchReviewAllowsSigning, customLaunchReviewLabel, type CustomLaunchReview } from "../lib/custom-launch-review";

const review: CustomLaunchReview = { schemaVersion: "programmable.custom-launch-manual-review.v1", reviewId: "10000000-0000-4000-8000-000000000001",
  subjectHash: `sha256:${"1".repeat(64)}`, chainId: "1", controller: WEBSITE_ADMIN_WALLET, state: "approved", revision: 2,
  submittedAt: "2026-10-08T00:00:00Z", approvedAt: "2026-10-08T04:00:00Z", expiresAt: "2026-10-08T05:00:00Z", reason: null };
function fixture(wallets: readonly `0x${string}`[] = [WEBSITE_ADMIN_WALLET]) {
  const fetchBackend = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ review }));
  const route = createManualReviewBridgeV1({ authenticator: { authenticate: async () => ({ privyUserId: "did:privy:admin", privySessionId: "session", wallets }) },
    backendBaseUrl: "https://api.programmable.market", websiteToken: "w".repeat(43), bffAssertionKeyV2: "b".repeat(43), fetchBackend });
  return { route, fetchBackend };
}
function request(body: unknown) { return new Request(`https://programmable.market/api/admin/custom-launch-reviews?walletAddress=${WEBSITE_ADMIN_WALLET}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://programmable.market" }, body: JSON.stringify(body),
}); }
const decision = { reviewId: review.reviewId, subjectHash: review.subjectHash, revision: 1, decision: "approve", reason: "Reviewed" };
describe("manual launch approval", () => {
  it("only enables signing inside the exact approval window", () => {
    expect(customLaunchReviewAllowsSigning(review, Date.parse(review.approvedAt!))).toBe(true);
    expect(customLaunchReviewAllowsSigning(review, Date.parse(review.expiresAt!))).toBe(false);
    expect(customLaunchReviewLabel(review, Date.parse(review.expiresAt!))).toBe("Approval expired");
    expect(customLaunchReviewAllowsSigning({ ...review, state: "pending" }, Date.parse(review.approvedAt!))).toBe(false);
  });
  it("requires the selected admin wallet to be linked to the authenticated account", async () => {
    const f = fixture(["0x2222222222222222222222222222222222222222"]);
    expect((await f.route(request(decision))).status).toBe(403); expect(f.fetchBackend).not.toHaveBeenCalled();
  });
  it("forwards only the exact decision and binds the verified reviewer server-side", async () => {
    const f = fixture(); expect((await f.route(request(decision))).status).toBe(200);
    const [url, init] = f.fetchBackend.mock.calls[0]!;
    expect(String(url)).toBe("https://api.programmable.market/v1/admin/custom-launch-reviews");
    expect(JSON.parse(String(init!.body))).toEqual(decision);
    const headers = new Headers(init!.headers);
    expect(headers.get("X-Programmable-Privy-User-Id")).toBe("did:privy:admin");
    expect(headers.get("X-Programmable-Wallet-Address")?.toLowerCase()).toBe(WEBSITE_ADMIN_WALLET.toLowerCase());
    expect((await f.route(request({ ...decision, reviewer: { privyUserId: "forged" } }))).status).toBe(400);
    expect(f.fetchBackend).toHaveBeenCalledTimes(1);
  });
});
