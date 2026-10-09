"use client";

import { createContext, useContext, useLayoutEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./responsive-trade-panel.module.css";

const WalletHandoff = createContext<(() => void) | null>(null);
export function TradeWalletHandoff({ children, onHandoff }: { children: ReactNode; onHandoff: () => void }) {
  return <WalletHandoff.Provider value={onHandoff}>{children}</WalletHandoff.Provider>;
}
const TradePanelState = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

/** Keep only the sheet visibility when loading replaces a market's trade adapter. */
export function TradePanelStateProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <TradePanelState.Provider value={{ open, setOpen }}>{children}</TradePanelState.Provider>;
}

/** Release the native top layer before Privy or a wallet opens its own dialog. */
export function TradeWalletButton({ handoff, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { handoff: boolean }) {
  const closeForWallet = useContext(WalletHandoff);
  return <button {...props} onClick={event => {
    onClick?.(event);
    if (handoff && !event.defaultPrevented) closeForWallet?.();
  }} />;
}

/** The same trade controls stay mounted when the mobile sheet opens or closes. */
export function ResponsiveTradePanel({ children, symbol }: { children: ReactNode; symbol?: string }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(true);
  const sharedState = useContext(TradePanelState);
  const [localOpen, setLocalOpen] = useState(false);
  const sheetOpen = sharedState?.open ?? localOpen;
  const setSheetOpen = sharedState?.setOpen ?? setLocalOpen;
  const initiallyOpen = useRef(sheetOpen);

  useLayoutEffect(() => {
    const media = window.matchMedia("(max-width: 1000px)");
    const update = (restore = false) => {
      if (!dialog.current) return;
      if (media.matches) {
        if (restore && initiallyOpen.current) {
          if (!dialog.current.matches(":modal")) {
            dialog.current.removeAttribute("open");
            dialog.current.showModal();
          }
        } else dialog.current.close();
      }
      else {
        if (dialog.current.matches(":modal")) dialog.current.close();
        // Setting the nonmodal open attribute preserves desktop focus and scroll.
        dialog.current.open = true;
      }
    };
    update(true);
    const resized = () => update();
    media.addEventListener("change", resized);
    return () => media.removeEventListener("change", resized);
  }, []);

  return <div className={styles.host}>
    <div className={styles.dock}>
      <button ref={trigger} type="button" className={styles.openButton} aria-haspopup="dialog" aria-controls={id}
        onClick={() => {
          if (!dialog.current) return;
          restoreFocus.current = true;
          dialog.current.dataset.sheetOpen = "true";
          setSheetOpen(true);
          dialog.current.showModal();
        }}>Trade{symbol ? ` ${symbol}` : ""}</button>
    </div>
    <dialog ref={dialog} id={id} open className={styles.panel} data-sheet-open={sheetOpen} aria-label={symbol ? `Trade ${symbol}` : "Trade"}
      onClose={() => { setSheetOpen(false); if (restoreFocus.current && sheetOpen && window.matchMedia("(max-width: 1000px)").matches) trigger.current?.focus(); }}
      onClick={event => {
        if (event.target !== event.currentTarget || !event.currentTarget.open) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
      }}>
      <div className={styles.sheetHeader}>
        <h2>{symbol ? `Trade ${symbol}` : "Trade"}</h2>
        <button type="button" className={styles.closeButton} aria-label="Close trade" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button>
      </div>
      <WalletHandoff.Provider value={() => {
        if (!dialog.current?.matches(":modal")) return;
        restoreFocus.current = false;
        setSheetOpen(false);
        dialog.current.close();
      }}>{children}</WalletHandoff.Provider>
    </dialog>
  </div>;
}
