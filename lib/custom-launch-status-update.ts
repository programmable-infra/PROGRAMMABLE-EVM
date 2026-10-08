import { customLaunchReviewLabel, parseCustomLaunchReview } from "./custom-launch-review";

type StatusRecord = { status?: unknown; manualReview?: unknown };
export function launchStatusFingerprint(record: StatusRecord): string {
  const review = record.manualReview ? parseCustomLaunchReview(record.manualReview) : null;
  return JSON.stringify([record.status, review?.reviewId, review?.revision, review?.state]);
}
export function launchStatusUpdateMessage(record: StatusRecord): string {
  if (record.manualReview && !["broadcast", "mined", "final", "source_verified", "indexed", "publicly_visible", "submitted", "finalized"].includes(String(record.status))) {
    const review = parseCustomLaunchReview(record.manualReview);
    return `${customLaunchReviewLabel(review)}. ${review.state === "rejected" ? "Read the feedback in this launch before resubmitting." : review.state === "approved" ? "Open the launch to review its current signing window." : "See the launch below for details."}`;
  }
  return "Launch status updated. See the latest confirmation and indexing details below.";
}
