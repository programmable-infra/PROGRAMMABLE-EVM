import { useState, useSyncExternalStore } from "react";
import { useWallet } from "../../../components/wallet-provider";
import type { PreparedModuleModeTransaction } from "../../../components/module-mode-wallet-state";

// Only the contract-preparation and SDK signing boundaries are replaced.
// The production WalletProvider, network verification and request lock run unchanged.
let enabled = false;
const admitted = new WeakSet<object>();
const listeners = new Set<() => void>();
const hash = `0x${"42".repeat(32)}`;
let state = { hold: false, checks: 0, requests: 0, prompts: 0, request: "", signing: false };
let finishValidation: (() => void) | undefined;
let finishSigning: { resolve: (value: string) => void; reject: (error: Error) => void } | undefined;
function update(patch: Partial<typeof state>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
export function enableModuleSigningFixture() { enabled = true; }
export function fixtureSigningEnabled() { return enabled; }
export function fixtureSignTransaction(request: unknown[]): Promise<string>;
export function fixtureSignTransaction(request: unknown): Promise<{ hash: string }>;
export async function fixtureSignTransaction(request: unknown): Promise<string | { hash: string }> {
  update({ prompts: state.prompts + 1, request: JSON.stringify(request, (_key, value) => typeof value === "bigint" ? value.toString() : value), signing: true });
  const result = await new Promise<string>((resolve, reject) => { finishSigning = { resolve, reject }; });
  return Array.isArray(request) ? result : { hash: result };
}
export function foundationPreparedWalletChainId(value: { transaction: { chainId: number } }) {
  if (!admitted.has(value)) throw new Error("Unknown fixture preparation");
  return value.transaction.chainId;
}
export async function revalidateModuleModeTransaction(value: { transaction: { from: string } }, account: string) {
  if (!admitted.has(value) || value.transaction.from.toLowerCase() !== account.toLowerCase()) throw new Error("Fixture account mismatch");
  update({ checks: state.checks + 1 });
  if (state.hold) await new Promise<void>(resolve => { finishValidation = resolve; });
  return value.transaction;
}
export async function foundationWalletRequestNonce() { return 7; }
export function noteFoundationWalletRequest(value: object) {
  if (!admitted.has(value)) throw new Error("Unknown fixture preparation");
  update({ requests: state.requests + 1 });
}
export function ModuleSigningControls() {
  const wallet = useWallet();
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
  const [result, setResult] = useState("");
  async function launch(chainId: number) {
    setResult("");
    const prepared = { sourceKind: "module-foundation-v1", transaction: {
      chainId, from: wallet.wallet!.account, to: "0x1111111111111111111111111111111111111111",
      data: "0x12345678", value: "0x0", gas: "0x186a0", action: "launch", description: "Fixture launch",
    } };
    admitted.add(prepared);
    try { await wallet.sendModuleModeTransaction(prepared as PreparedModuleModeTransaction); setResult("submitted"); }
    catch (error) { const failure = error as Error & { walletRequestAttempted?: boolean }; setResult(`${failure.message}; attempted=${failure.walletRequestAttempted}`); }
  }
  return <section aria-label="Module signing fixture">
    <button onClick={() => void launch(1)}>Launch Ethereum fixture</button>
    <button onClick={() => void launch(4663)}>Launch Robinhood fixture</button>
    <button onClick={() => update({ hold: true })}>Hold fresh validation</button>
    <button onClick={() => { update({ hold: false }); finishValidation?.(); finishValidation = undefined; }}>Finish fresh validation</button>
    <output aria-label="Module signing result">{result}</output>
    <output aria-label="Module validation count">{current.checks}</output>
    <output aria-label="Module request marker count">{current.requests}</output>
    <output aria-label="Module signing prompt count">{current.prompts}</output>
    <output aria-label="Module signing request">{current.request}</output>
    {current.signing ? <section role="dialog" aria-label="Transaction signing fixture">
      <p>Local SDK boundary only. No blockchain transaction.</p>
      <button onClick={() => { update({ signing: false }); finishSigning?.resolve(hash); }}>Confirm fixture signature</button>
      <button onClick={() => { update({ signing: false }); finishSigning?.reject(Object.assign(new Error("User rejected transaction"), { code: 4001 })); }}>Reject fixture signature</button>
    </section> : null}
  </section>;
}
