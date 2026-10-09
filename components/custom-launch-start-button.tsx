"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./developer-api-keys.module.css";
import { useWallet } from "./wallet-provider";
import { customLaunchReviewNeedsStart, type CustomLaunchReview } from "@/lib/custom-launch-review";

export function CustomLaunchStartButton({ review, launchId, onStarted }: {
  review: CustomLaunchReview; launchId: string; onStarted: () => unknown;
}) {
  const { wallet, getAccessToken, getIdentityToken } = useWallet();
  const generation = useRef(0), pending = useRef(false);
  useEffect(() => () => { generation.current += 1; pending.current = false; }, [wallet?.account, launchId, review.revision]);
  const [busy, setBusy] = useState(false), [started, setStarted] = useState(false), [error, setError] = useState("");
  if (!customLaunchReviewNeedsStart(review)) return null;
  async function start() {
    if (pending.current || started) return;
    pending.current = true; const operation = generation.current;
    setBusy(true); setError("");
    try {
      const [token, identity] = await Promise.all([getAccessToken(), getIdentityToken()]);
      if (!token || !wallet?.account) throw new Error("Connect the wallet that submitted this launch.");
      const response = await fetch("/api/custom-launch-reviews/start", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(identity ? { "X-Privy-Identity-Token": identity } : {}) },
        body: JSON.stringify({ chainId: review.chainId, launchId, walletAddress: wallet.account }), signal: AbortSignal.timeout(20000) });
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Could not start this launch. Try again.");
      if (operation === generation.current) { setStarted(true); await onStarted(); }
    } catch (cause) { if (operation === generation.current) setError(cause instanceof Error ? cause.message : "Could not start this launch."); }
    finally { if (operation === generation.current) { pending.current = false; setBusy(false); } }
  }
  return <div><button className={styles.primaryButton} type="button" disabled={busy || started} onClick={() => void start()}>{busy || started ? "Preparing your launch…" : "Start launch"}</button>
    <p>Start when you are ready to confirm in your wallet. Your transaction will be prepared with a fresh signing window.</p>
    {error && <p role="alert">{error}</p>}</div>;
}
