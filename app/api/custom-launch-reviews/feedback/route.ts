import { sendReviewedLaunchFeedbackV4 } from "@/lib/server/custom-launch/manual-review-feedback-v4";
export const runtime = "nodejs";
export const POST = sendReviewedLaunchFeedbackV4;

export const maxDuration = 90;
