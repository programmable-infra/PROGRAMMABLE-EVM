"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./developer-api-keys.module.css";
import { useWallet } from "./wallet-provider";
import { customLaunchReviewNeedsStart, type CustomLaunchReview } from "@/lib/custom-launch-review";

// Preparation is authenticated and approval-gated. It never opens the wallet;
// the owner still clicks Sign and launch for the actual transaction.
export function CustomLaunchStartButton({ review, launchId, onStarted }: {
  review: CustomLaunchReview; launchId: string; onStarted: () => unknown;
}) {
  const { wallet, getAccessToken, getIdentityToken } = useWallet();
  const callbacks = useRef({ getAccessToken, getIdentityToken, onStarted });
  useEffect(() => { callbacks.current = { getAccessToken, getIdentityToken, onStarted }; }, [getAccessToken, getIdentityToken, onStarted]);
  const [retry, setRetry] = useState(0), [error, setError] = useState("");
  const needsStart = customLaunchReviewNeedsStart(review);
  const account = wallet?.account;
  const { chainId, controller: owner, revision } = review;
  useEffect(() => {
    if (!needsStart || !account || account.toLowerCase() !== owner.toLowerCase()) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const [token, identity] = await Promise.all([callbacks.current.getAccessToken(), callbacks.current.getIdentityToken()]);
        if (controller.signal.aborted) return;
        if (!token) throw new Error("Sign in again to prepare your launch.");
        const response = await fetch("/api/custom-launch-reviews/start", { method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(identity ? { "X-Privy-Identity-Token": identity } : {}) },
          body: JSON.stringify({ chainId, launchId, walletAddress: account }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        const value = await response.json();
        if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Could not prepare this launch. Try again.");
        if (!controller.signal.aborted) await callbacks.current.onStarted();
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not prepare this launch.");
      }
    })();
    return () => controller.abort();
  }, [needsStart, account, owner, chainId, launchId, revision, retry]);
  if (!needsStart) return null;
  if (!account || account.toLowerCase() !== owner.toLowerCase()) return <p>Connect the wallet that submitted this launch.</p>;
  return <div>
    <button className={styles.primaryButton} type="button" disabled={!error} onClick={() => { setError(""); setRetry(value => value + 1); }}>
      {error ? "Retry preparation" : "Preparing your launch…"}
    </button>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
