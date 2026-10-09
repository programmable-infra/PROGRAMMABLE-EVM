"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/wallet-provider";
import { isWebsiteAdminWallet } from "@/lib/admin-access";
import { customLaunchReviewLabel, customLaunchReviewOverdue, parseCustomLaunchReview, type CustomLaunchReview } from "@/lib/custom-launch-review";
import styles from "./custom-launch-review-console.module.css";
type ReviewRow = CustomLaunchReview & { launchId: string; requestSummary: Record<string, unknown> };
type ReviewDetail = CustomLaunchReview & { launchId: string; request: Record<string, unknown>; technicalStatus: Record<string, unknown> };
export function CustomLaunchReviewConsole() {
  const { authReady, authenticated, connecting, openWallet, wallet } = useWallet();
  const account = authenticated && isWebsiteAdminWallet(wallet?.account) ? wallet?.account : null;
  return <main className={styles.page}>
    <header><Link href="/admin/partners">Partner access</Link><h1>Custom launch reviews</h1><p>Review applications within 24 hours. Approval opens a separate 24-hour launch window.</p></header>
    {account ? <AccountReviews key={account} account={account} /> :
      <section><p>{!authReady ? "Loading…" : authenticated ? "Connect an authorized admin wallet to continue." : "Sign in with your admin wallet."}</p><button disabled={connecting || !authReady} onClick={() => openWallet()}>Connect wallet</button></section>}
  </main>;
}

function AccountReviews({ account }: { account: string }) {
  const { getAccessToken, getIdentityToken } = useWallet();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [reviews, setReviews] = useState<ReviewRow[]>([]), [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [reason, setReason] = useState("");
  const request = useCallback(async (reviewId?: string, decision?: { review: ReviewDetail; choice: "approve" | "reject"; reason: string }) => {
    if (!account) throw new Error("Connect an admin wallet.");
    const [token, identityToken] = await Promise.all([getAccessToken(), getIdentityToken()]);
    if (!token || !active.current) throw new Error("Reconnect your admin wallet.");
    const query = new URLSearchParams({ walletAddress: account });
    if (reviewId && !decision) query.set("reviewId", reviewId);
    const response = await fetch(`/api/admin/custom-launch-reviews?${query}`, {
      method: decision ? "POST" : "GET", cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(identityToken ? { "X-Privy-Identity-Token": identityToken } : {}), "Content-Type": "application/json" },
      body: decision ? JSON.stringify({ reviewId: decision.review.reviewId, subjectHash: decision.review.subjectHash, revision: decision.review.revision, decision: decision.choice, reason: decision.reason }) : undefined,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(response.status === 409 ? "This review changed. Refresh before deciding." : response.status === 403 ? "This wallet is not authorized to review launches." : "Could not load launch reviews. Try again.");
    if (!active.current) throw new Error("Wallet changed. Refresh to continue.");
    return value;
  }, [account, getAccessToken, getIdentityToken]);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { const value = await request(); value.reviews.forEach(parseCustomLaunchReview); setReviews(value.reviews); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load reviews."); }
    finally { setBusy(false); }
  }, [request]);
  useEffect(() => {
    let current = true;
    request().then(value => {
      value.reviews.forEach(parseCustomLaunchReview);
      if (current) setReviews(value.reviews);
    }).catch(error => {
      if (current) setError(error instanceof Error ? error.message : "Unable to load reviews.");
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [request]);
  async function select(reviewId: string) {
    setBusy(true); setError(""); setDetail(null); setReason("");
    try { const value = await request(reviewId); parseCustomLaunchReview(value.review); setDetail(value.review); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load launch."); } finally { setBusy(false); }
  }
  async function decide(decision: "approve" | "reject") {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      const value = await request(detail.reviewId, { review: detail, choice: decision, reason }); const updated = parseCustomLaunchReview(value.review);
      setDetail(current => current ? { ...current, ...updated } : null);
      setReviews(current => current.map(item => item.reviewId === updated.reviewId ? { ...item, ...updated } : item));
    } catch (e) { setError(e instanceof Error ? e.message : "Decision could not be saved."); } finally { setBusy(false); }
  }
  const canDecide = detail && customLaunchReviewLabel(detail, now) !== "Approved";
  return <>
      <button disabled={busy} onClick={() => void load()}>Refresh</button>
      <div className={styles.layout}><section aria-label="Launch review queue">
        {!busy && !error && reviews.length === 0 && <p>No launches awaiting review.</p>}
        {reviews.map(review => <button className={styles.row} key={review.reviewId} disabled={busy} onClick={() => void select(review.reviewId)}>
          <strong>{review.chainId === "1" ? "Ethereum" : "Robinhood"} · {customLaunchReviewLabel(review, now)}</strong>
          <span>{review.controller}</span>{customLaunchReviewOverdue(review, now) && <strong>Review overdue</strong>}<small>{new Date(review.submittedAt).toLocaleString()}</small>
        </button>)}
      </section><section aria-label="Selected launch">{detail ? <>
        <h2>{customLaunchReviewLabel(detail, now)}</h2><p className={styles.address}>{detail.controller}</p>
        {detail.state === "pending" && <p>{customLaunchReviewOverdue(detail, now) ? "Review overdue. The application remains open." : `Review due ${new Date(detail.reviewDueAt ?? Date.parse(detail.submittedAt) + 86_400_000).toLocaleString()}.`}</p>}
        {detail.expiresAt && <p>Launch window ends {new Date(detail.expiresAt).toLocaleString()}.</p>}
        {detail.reason && <p>{detail.reason}</p>}
        <h3>Technical checks</h3><pre>{JSON.stringify(detail.technicalStatus, null, 2)}</pre>
        <details><summary>Submitted launch and source</summary><pre>{JSON.stringify(detail.request, null, 2)}</pre></details>
        <p className={styles.address}>Reviewed version: {detail.subjectHash}</p>
        {canDecide && <><label>Note to the team <textarea maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
          <div className={styles.actions}><button disabled={busy} onClick={() => void decide("approve")}>Approve for 24 hours</button><button disabled={busy} onClick={() => void decide("reject")}>Request changes</button></div></>}
      </> : <p>Select a launch to review its submitted configuration and checks.</p>}</section></div>
    {error && <p role="alert">{error}</p>}
  </>;
}
