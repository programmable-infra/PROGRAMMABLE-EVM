"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/wallet-provider";
import { isWebsiteAdminWallet } from "@/lib/admin-access";
import { customLaunchReviewLabel, parseCustomLaunchReview, type CustomLaunchReview } from "@/lib/custom-launch-review";
import styles from "./custom-launch-review-console.module.css";
type ReviewRow = CustomLaunchReview & { launchId: string; requestSummary: Record<string, unknown> };
type ReviewDetail = CustomLaunchReview & { launchId: string; request: Record<string, unknown>; technicalStatus: Record<string, unknown> };
export function CustomLaunchReviewConsole() {
  const { authReady, authenticated, connecting, getAccessToken, getIdentityToken, openWallet, wallet } = useWallet();
  const account = authenticated && isWebsiteAdminWallet(wallet?.account) ? wallet?.account : null;
  const identity = useRef(account); identity.current = account;
  const [reviews, setReviews] = useState<ReviewRow[]>([]), [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [reason, setReason] = useState("");
  const request = useCallback(async (reviewId?: string, decision?: "approve" | "reject") => {
    if (!account) throw new Error("Connect an admin wallet.");
    const [token, identityToken] = await Promise.all([getAccessToken(), getIdentityToken()]);
    if (!token || !identityToken || identity.current !== account) throw new Error("Reconnect your admin wallet.");
    const query = new URLSearchParams({ walletAddress: account });
    if (reviewId && !decision) query.set("reviewId", reviewId);
    const response = await fetch(`/api/admin/custom-launch-reviews?${query}`, {
      method: decision ? "POST" : "GET", cache: "no-store", headers: { Authorization: `Bearer ${token}`, "X-Privy-Identity-Token": identityToken, "Content-Type": "application/json" },
      body: decision && detail ? JSON.stringify({ reviewId: detail.reviewId, subjectHash: detail.subjectHash, revision: detail.revision, decision, reason }) : undefined,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(response.status === 409 ? "This review changed. Refresh before deciding." : response.status === 403 ? "This wallet is not authorized to review launches." : "Could not load launch reviews. Try again.");
    if (identity.current !== account) throw new Error("Wallet changed. Refresh to continue.");
    return value;
  }, [account, getAccessToken, getIdentityToken, detail, reason]);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { const value = await request(); value.reviews.forEach(parseCustomLaunchReview); setReviews(value.reviews); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load reviews."); }
    finally { setBusy(false); }
  }, [request]);
  // Reload on wallet identity changes; editing a decision must not trigger a fetch.
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => { setReviews([]); setDetail(null); setReason(""); if (account) void loadRef.current(); }, [account]);
  async function select(reviewId: string) {
    setBusy(true); setError(""); setDetail(null); setReason("");
    try { const value = await request(reviewId); parseCustomLaunchReview(value.review); setDetail(value.review); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load launch."); } finally { setBusy(false); }
  }
  async function decide(decision: "approve" | "reject") {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      const value = await request(detail.reviewId, decision); const updated = parseCustomLaunchReview(value.review);
      setDetail(current => current ? { ...current, ...updated } : null);
      setReviews(current => current.map(item => item.reviewId === updated.reviewId ? { ...item, ...updated } : item));
    } catch (e) { setError(e instanceof Error ? e.message : "Decision could not be saved."); } finally { setBusy(false); }
  }
  const canDecide = detail && customLaunchReviewLabel(detail) !== "Approved";
  return <main className={styles.page}>
    <header><Link href="/admin/partners">Partner access</Link><h1>Custom launch reviews</h1><p>Approve a launch to open its one-hour launch window.</p></header>
    {!account ? <section><p>{!authReady ? "Loading…" : authenticated ? "Connect an authorized admin wallet to continue." : "Sign in with your admin wallet."}</p><button disabled={connecting || !authReady} onClick={() => openWallet()}>Connect wallet</button></section> : <>
      <button disabled={busy} onClick={() => void load()}>Refresh</button>
      <div className={styles.layout}><section aria-label="Launch review queue">
        {!busy && reviews.length === 0 && <p>No launches awaiting review.</p>}
        {reviews.map(review => <button className={styles.row} key={review.reviewId} disabled={busy} onClick={() => void select(review.reviewId)}>
          <strong>{review.chainId === "1" ? "Ethereum" : "Robinhood"} · {customLaunchReviewLabel(review)}</strong>
          <span>{review.controller}</span><small>{new Date(review.submittedAt).toLocaleString()}</small>
        </button>)}
      </section><section aria-label="Selected launch">{detail ? <>
        <h2>{customLaunchReviewLabel(detail)}</h2><p className={styles.address}>{detail.controller}</p>
        {detail.expiresAt && <p>Launch window ends {new Date(detail.expiresAt).toLocaleString()}.</p>}
        {detail.reason && <p>{detail.reason}</p>}
        <h3>Technical checks</h3><pre>{JSON.stringify(detail.technicalStatus, null, 2)}</pre>
        <details><summary>Submitted launch and source</summary><pre>{JSON.stringify(detail.request, null, 2)}</pre></details>
        <p className={styles.address}>Reviewed version: {detail.subjectHash}</p>
        {canDecide && <><label>Note to the team <textarea maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
          <div className={styles.actions}><button disabled={busy} onClick={() => void decide("approve")}>Approve for 1 hour</button><button disabled={busy} onClick={() => void decide("reject")}>Request changes</button></div></>}
      </> : <p>Select a launch to review its submitted configuration and checks.</p>}</section></div>
    </>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
