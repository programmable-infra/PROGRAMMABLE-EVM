"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, getAddress, type Hex } from "viem";
import { useFoundationSession } from "@/components/module-foundation-session";
import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { foundationChainProfile, type FoundationChainId } from "@/lib/module-foundation/chains";
import { prepareFoundationClaim } from "@/lib/module-foundation/client";
import type { FoundationPool } from "@/lib/module-foundation/route";
import type { FoundationProfileLaunch } from "@/lib/profile/module-launches";
import { readFoundationProfileRewards } from "@/lib/profile/foundation-rewards";
import styles from "./robinhood-profile-launches.module.css";

type FeeBalance = Awaited<ReturnType<typeof readFoundationProfileRewards>> & { context: string };

/** Indexed launch identity supplies the row; the wallet path independently verifies the live pool and recipient. */
export function FoundationProfileClaim({ launch, account, chainId = 4663 }: { launch: FoundationProfileLaunch; account: string; chainId?: FoundationChainId }) {
  const token = getAddress(launch.tokenAddress);
  const session = useFoundationSession(token, chainId);
  const explorer = foundationChainProfile(chainId).explorer;
  const liveRefresh = useLiveDataRefresh({ intervalMs: 30_000 });
  const [balanceState, setBalanceState] = useState<FeeBalance | null>(null);
  const [balanceError, setBalanceError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const claiming = useRef(false);
  const [message, setMessage] = useState("");
  const [transactionHash, setTransactionHash] = useState<Hex | null>(null);
  const owner = session.account?.toLowerCase() === account.toLowerCase()
    && launch.creator.toLowerCase() === account.toLowerCase();
  const balance = balanceState?.context === session.contextKey ? balanceState : null;
  const releaseDigest = session.envelope?.binding?.releaseDigest;
  const savedClaim = session.resolution?.metadata?.operationKind === "claim"
    && session.resolution.metadata.token?.toLowerCase() === token.toLowerCase() ? session.resolution : null;
  // A successful, displayed result can be acknowledged by the next Claim click.
  // Pending, unreadable and reverted operations still require recovery first.
  const claimBlocked = session.preparationBlocked
    ?? (session.resolution?.status === "success" ? undefined : session.submissionBlocked);

  useEffect(() => {
    if (!owner || session.availability.status !== "ready" || !releaseDigest) return;
    let active = true;
    void readFoundationProfileRewards(session.client, session.envelope!.binding!, launch).then(value => {
      if (active) { setBalanceError(""); setBalanceState({ context: session.contextKey, ...value }); }
    }).catch(() => { if (active) { setBalanceState(null); setBalanceError("Rewards could not be checked."); } });
    return () => { active = false; };
  }, [account, launch.creator, launch.feeLedgerAddress, launch.quoteAsset, launch.sourceReleaseDigest, owner,
    launch, releaseDigest, refresh, liveRefresh, session.availability.status, session.client, session.contextKey, session.envelope, session.resultGeneration]);

  async function claim() {
    if (!session.account || !owner || claiming.current || !balance || balance.amount <= 0n) return;
    claiming.current = true;
    const wallet = session.account;
    const context = session.contextKey;
    setBusy(true);
    setMessage("Checking the current payout…");
    setTransactionHash(null);
    try {
      if (claimBlocked) throw new Error(claimBlocked);
      session.assertCurrent(wallet, context);
      if (session.resolution?.status === "success") await session.acknowledgeResult(session.resolution.operationId, false);
      const pool: FoundationPool = { token, quote: getAddress(launch.quoteAsset), hook: getAddress(launch.hookAddress), poolId: launch.poolId as Hex };
      const sequence = await prepareFoundationClaim({ client: session.client, binding: await session.resolveAuthority(),
        account: wallet, pool, beneficiary: "creator" });
      if (sequence.recipient !== getAddress(launch.creator)) throw new Error("The payout recipient changed.");
      session.assertCurrent(wallet, context);
      setMessage("Confirm the fee payout in your wallet…");
      const outcome = await session.execute(sequence);
      setTransactionHash(outcome.result.transactionHash);
      if (outcome.result.status === "confirmed" && outcome.result.operationComplete) {
        setMessage("Fee payout confirmed onchain.");
        setBalanceState(null);
        setRefresh(value => value + 1);
      } else {
        setMessage(outcome.result.message ?? "The transaction was sent. Check its confirmation before claiming again.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The fee payout could not be prepared.");
    } finally {
      claiming.current = false;
      setBusy(false);
    }
  }

  async function acknowledgeSavedClaim() {
    if (!savedClaim || acknowledging) return;
    setAcknowledging(true);
    try { await session.acknowledgeResult(savedClaim.operationId); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The saved result could not be cleared."); }
    finally { setAcknowledging(false); }
  }

  if (!owner) return null;
  const ready = session.availability.status === "ready" && !balanceError && balance !== null;
  return <div className={styles.claimArea}>
    {session.walletAction ? <button type="button" disabled={session.walletAction.busy} onClick={session.walletAction.onClick}>
      {session.walletAction.label}</button> : session.availability.status === "unavailable" || balanceError
      ? <button type="button" onClick={() => { setBalanceError(""); session.retryAvailability(); setRefresh(value => value + 1); }}>Retry fee check</button>
      : <button type="button" disabled={!ready || balance!.amount === 0n || busy || Boolean(claimBlocked)} onClick={() => void claim()}>
        {busy ? "Claiming…" : "Claim Rewards"}</button>}
    <span className={styles.claimStatus}>{balanceError || session.availability.status === "unavailable" ? balanceError || "Fee claims are temporarily unavailable"
      : !ready ? "Checking rewards…" : `${formatUnits(balance.amount, balance.decimals)} ${balance.symbol} available`}</span>
    {ready && balance.wrappedEth ? <span className={styles.claimStatus}>Paid to your wallet as wrapped ETH.</span> : null}
    {savedClaim ? <><span className={styles.claimStatus}>{savedClaim.status === "success" ? "Fee payout saved at" : "Reverted transaction at"} block {savedClaim.blockNumber}.{" "}
      <a href={`${explorer}/tx/${savedClaim.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a></span>
      <button type="button" disabled={acknowledging} onClick={() => void acknowledgeSavedClaim()}>{acknowledging ? "Continuing…" : "Continue"}</button></>
      : session.resolution?.status === "success" ? <span className={styles.claimStatus}>Previous transaction confirmed.{" "}
        <a href={`${explorer}/tx/${session.resolution.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a></span>
      : session.submissionBlocked ? <span className={styles.claimStatus}>{session.submissionBlocked}{" "}
        <a href={`/modules/${session.resolution?.metadata?.token ?? token}?chainId=${chainId}`}>Review wallet activity</a></span> : null}
    {message ? <p className={styles.claimMessage} role="status">{message}{transactionHash ? <> <a href={`${explorer}/tx/${transactionHash}`}
      target="_blank" rel="noreferrer">View transaction</a></> : null}</p> : null}
  </div>;
}
