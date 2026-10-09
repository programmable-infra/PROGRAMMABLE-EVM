"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { SwapPanel } from "./swap-panel";
import { TradeWalletHandoff } from "./responsive-trade-panel";
import { PINNED_ROBINHOOD_CHAIN_ID, PINNED_ROBINHOOD_TOKEN } from "@/lib/robinhood-explore-policy";
import styles from "./quick-swap.module.css";

export function QuickSwapDialog({ id, open, triggerRef, onOpenChange }: {
  id: string;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef(true);
  useEffect(() => {
    if (open && !dialog.current?.open) {
      restoreFocus.current = true;
      dialog.current?.showModal();
    } else if (!open) dialog.current?.close();
  }, [open]);

  return createPortal(<dialog ref={dialog} id={id} className={styles.dialog} aria-labelledby={`${id}-title`}
    onClose={() => { onOpenChange(false); if (restoreFocus.current) triggerRef.current?.focus(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.currentTarget.close();
    }}>
    <header className={styles.heading}>
      <div><h2 id={`${id}-title`}>Swap</h2><span>V4 · Robinhood</span></div>
      <button type="button" className={styles.close} aria-label="Close swap" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button>
    </header>
    <TradeWalletHandoff onHandoff={() => {
      // Keep the trade mounted, but release the top layer for the wallet dialog.
      restoreFocus.current = false;
      dialog.current?.close();
      onOpenChange(false);
    }}>
      <SwapPanel embedded active={open} initialAddress={PINNED_ROBINHOOD_TOKEN}
        initialChainId={PINNED_ROBINHOOD_CHAIN_ID} tokenSymbol="V4" initialSlippageBps={50} />
    </TradeWalletHandoff>
    <details className={styles.protection}>
      <summary>Trade protection</summary>
      <p>Your swap enforces a minimum output and a deadline. Private MEV protection is not available through this Robinhood route.</p>
    </details>
  </dialog>, document.body);
}
