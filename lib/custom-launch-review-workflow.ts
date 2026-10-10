export interface ReviewMessageV4 {
  revision: number; createdAt: string; author: "applicant" | "reviewer";
  message: string; links: readonly string[];
}
export interface ReviewWorkflowV4 {
  tradeChecks?: Record<string, unknown> | null;
  discussion?: readonly ReviewMessageV4[];
  supersededBy?: { reviewId: string; launchId: string } | null;
}
export const REVIEW_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export function reviewLinksV4(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 3 && value.every(link => {
    if (typeof link !== "string" || link.length > 2048) return false;
    try { const url = new URL(link); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  });
}
export function parseReviewWorkflowV4(value: ReviewWorkflowV4): ReviewWorkflowV4 {
  if (value.discussion !== undefined && (!Array.isArray(value.discussion) || value.discussion.length > 64
    || value.discussion.some(m => !m || !Number.isSafeInteger(m.revision) || m.revision < 1
      || !Number.isFinite(Date.parse(m.createdAt)) || !["applicant", "reviewer"].includes(m.author)
      || typeof m.message !== "string" || m.message.length > 12000 || !reviewLinksV4(m.links)))) throw new TypeError("Invalid review discussion");
  if (value.supersededBy != null && (!REVIEW_UUID_V4.test(value.supersededBy.reviewId) || !REVIEW_UUID_V4.test(value.supersededBy.launchId))) throw new TypeError("Invalid review replacement");
  if (value.tradeChecks != null && (typeof value.tradeChecks !== "object" || value.tradeChecks.schemaVersion !== "programmable.review-trade-report.v4" || JSON.stringify(value.tradeChecks).length > 16000)) throw new TypeError("Invalid trading check report");
  return { ...(value.tradeChecks === undefined ? {} : { tradeChecks: value.tradeChecks }), ...(value.discussion === undefined ? {} : { discussion: value.discussion }),
    ...(value.supersededBy === undefined ? {} : { supersededBy: value.supersededBy }) };
}
