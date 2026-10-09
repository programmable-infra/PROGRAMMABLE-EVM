"use client";

import dynamic from "next/dynamic";
import { useId, useRef, useState } from "react";
import styles from "./quick-swap.module.css";

const loadDialog = () => import("./quick-swap-dialog");
const QuickSwapDialog = dynamic(() => loadDialog().then(module => module.QuickSwapDialog));

export function QuickSwap() {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  const [open, setOpen] = useState(false);

  return <>
    <button ref={trigger} className={styles.trigger} type="button" aria-haspopup="dialog"
      aria-controls={opened ? id : undefined} aria-expanded={open}
      onPointerEnter={() => { void loadDialog(); }} onFocus={() => { void loadDialog(); }}
      onClick={() => { setOpened(true); setOpen(true); }}>Swap</button>
    {opened ? <QuickSwapDialog id={id} open={open} triggerRef={trigger} onOpenChange={setOpen} /> : null}
  </>;
}
