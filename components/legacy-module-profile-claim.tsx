"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatUnits, getAddress, type Hex } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { assertModuleModeWalletUnchanged, moduleModeWalletStep, submitModuleModeOperation, switchModuleModeNetwork, useModuleModeOperation } from "@/components/module-mode-wallet-state";
import { useModuleWalletRequestPending } from "@/components/module-mode-launch-host";
import { createModuleEngineClient, ModuleEngineTransactionRevertedError } from "@/lib/module-engine/client";
import { ModuleNativeTransactionRevertedError } from "@/lib/module-mode/native-client";
import { clearModuleModeOperation, moduleModeOperationPath } from "@/lib/module-mode-operation-store";
import { prepareLegacyModuleRewards, readLegacyModuleRewards, type LegacyProfileLaunch } from "@/lib/profile/legacy-module-rewards";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import styles from "./robinhood-profile-launches.module.css";

export function LegacyModuleProfileClaim({ launch, account }: { launch: LegacyProfileLaunch; account: string }) {
  const wallet = useWallet();
  const [client] = useState(createModuleEngineClient);
  const [balance, setBalance] = useState<Awaited<ReturnType<typeof readLegacyModuleRewards>> | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState<Hex | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const liveRefresh = useLiveDataRefresh({ intervalMs: 30_000 });
  const claiming = useRef(false), mounted = useRef(true);
  const current = { account: wallet.wallet?.account, chainId: wallet.wallet?.chainId, authenticated: wallet.authenticated, sessionReady: wallet.sessionReady };
  const currentWallet = useRef(current);
  useLayoutEffect(() => { currentWallet.current = current; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const saved = useModuleModeOperation(wallet.wallet?.account);
  const requestPending = useModuleWalletRequestPending(wallet.wallet?.account);
  const owner = account.toLowerCase() === launch.creator.toLowerCase() && wallet.wallet?.account.toLowerCase() === account.toLowerCase();
  const step = moduleModeWalletStep(current);

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    void readLegacyModuleRewards(client, launch, getAddress(account), controller.signal).then(value => {
      if (!controller.signal.aborted) { setBalance(value); setError(""); }
    }).catch(() => { if (!controller.signal.aborted) { setBalance(null); setError("Rewards could not be checked."); } });
    return () => controller.abort();
  }, [account, client, launch, owner, refresh, liveRefresh]);

  async function claim() {
    if (!owner || step !== "prepare" || claiming.current || saved.blocked || requestPending || !balance || balance.amount <= 0n) return;
    claiming.current = true; setBusy(true); setMessage("Checking rewards…"); setHash(null);
    const actor = getAddress(account);
    const assertCurrent = () => {
      if (!mounted.current) throw new Error("The profile changed. Try again.");
      assertModuleModeWalletUnchanged(currentWallet.current, actor);
    };
    let sent: Awaited<ReturnType<typeof submitModuleModeOperation>> | undefined;
    try {
      assertCurrent();
      const operation = await prepareLegacyModuleRewards(client, launch, actor);
      assertCurrent(); setMessage("Confirm the payout in your wallet…");
      sent = await submitModuleModeOperation(operation.prepared, prepared => {
        try { assertCurrent(); } catch (cause) { throw Object.assign(cause as Error, { walletRequestAttempted: false }); }
        return wallet.sendModuleModeTransaction(prepared);
      });
      if (mounted.current) { setHash(sent.transactionHash); setMessage("Waiting for confirmation…"); }
      await operation.confirm(sent.transactionHash);
      await clearModuleModeOperation(sent.operation);
      if (mounted.current) { setMessage("Rewards sent to your wallet."); setBalance(null); setRefresh(value => value + 1); }
    } catch (cause) {
      if (sent && (cause instanceof ModuleNativeTransactionRevertedError || cause instanceof ModuleEngineTransactionRevertedError)
        && cause.transactionHash === sent.transactionHash) await clearModuleModeOperation(sent.operation).catch(() => undefined);
      if (mounted.current) setMessage(cause instanceof Error ? cause.message : "The payout could not be completed.");
    } finally { claiming.current = false; if (mounted.current) setBusy(false); }
  }

  if (!owner) return null;
  return <div className={styles.claimArea}>
    {step !== "prepare" ? <button type="button" disabled={busy || wallet.connecting || wallet.switchingNetwork}
      onClick={() => void Promise.resolve().then(() => step === "connect" ? wallet.openWallet() : switchModuleModeNetwork(wallet.switchNetwork)).catch(cause => setMessage(String(cause)))}>
      {step === "connect" ? "Connect wallet" : "Switch to Robinhood"}</button>
      : error ? <button type="button" onClick={() => setRefresh(value => value + 1)}>Retry fee check</button>
      : <button type="button" disabled={busy || saved.blocked || requestPending || !balance || balance.amount <= 0n} onClick={() => void claim()}>
        {busy ? "Claiming…" : "Claim Rewards"}</button>}
    <span className={styles.claimStatus}>{error || (balance ? `${formatUnits(balance.amount, balance.decimals)} ${balance.symbol} available · Shared fee balance` : "Checking rewards…")}</span>
    {saved.blocked ? <span className={styles.claimStatus}>{saved.operation ? <a href={moduleModeOperationPath(saved.operation)}>Check pending transaction</a> : saved.error}</span> : null}
    {message ? <p className={styles.claimMessage} role="status">{message}{hash ? <> <a href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction</a></> : null}</p> : null}
  </div>;
}
