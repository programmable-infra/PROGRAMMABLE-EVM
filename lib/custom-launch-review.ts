export type CustomLaunchReview = Readonly<{
  schemaVersion: "programmable.custom-launch-manual-review.v1";
  reviewId: string;
  subjectHash: string;
  chainId: "1" | "4663";
  controller: string;
  state: "pending" | "approved" | "rejected" | "expired";
  revision: number;
  submittedAt: string;
  approvedAt: string | null;
  expiresAt: string | null;
  reason: string | null;
}>;

export function parseCustomLaunchReview(value: unknown): CustomLaunchReview {
  const v = value as CustomLaunchReview | undefined;
  if (!v || v.schemaVersion !== "programmable.custom-launch-manual-review.v1"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(v.reviewId)
    || !/^sha256:[0-9a-f]{64}$/u.test(v.subjectHash) || !["1", "4663"].includes(v.chainId)
    || !/^0x[0-9a-fA-F]{40}$/u.test(v.controller) || !["pending", "approved", "rejected", "expired"].includes(v.state)
    || !Number.isSafeInteger(v.revision) || v.revision < 1 || !Number.isFinite(Date.parse(v.submittedAt))
    || (v.approvedAt !== null && !Number.isFinite(Date.parse(v.approvedAt)))
    || (v.expiresAt !== null && !Number.isFinite(Date.parse(v.expiresAt)))
    || (v.reason !== null && typeof v.reason !== "string")) throw new Error("Invalid launch review");
  return v;
}

export function customLaunchReviewAllowsSigning(review: CustomLaunchReview, now = Date.now()) {
  const approved = Date.parse(review.approvedAt ?? ""), expires = Date.parse(review.expiresAt ?? "");
  return review.state === "approved" && approved <= now && expires > now && expires - approved === 3_600_000;
}

export function customLaunchReviewLabel(review: CustomLaunchReview, now = Date.now()) {
  if (review.state === "approved") {
    const approved = Date.parse(review.approvedAt ?? ""), expires = Date.parse(review.expiresAt ?? "");
    // A fresh server approval can be slightly ahead of the browser clock.
    // Its status is approved even while signing waits for the start time.
    return expires > now && expires - approved === 3_600_000 ? "Approved" : "Approval expired";
  }
  return review.state === "pending" ? "Review pending" : review.state === "rejected" ? "Changes requested" : "Approval expired";
}

export function customLaunchReviewDescription(review: CustomLaunchReview) {
  if (customLaunchReviewLabel(review) === "Approved") return `Approved. Launch by ${new Date(review.expiresAt!).toLocaleString()}.`;
  if (review.state === "pending") return "Your launch is waiting for Programmable approval. No extra application is needed. This page updates automatically.";
  if (review.state === "rejected") return review.reason || "Programmable requested changes to this launch.";
  return "The one-hour approval window has ended. A new approval is required before signing.";
}
