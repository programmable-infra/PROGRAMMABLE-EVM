"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, PublicClient } from "viem";
import { FoundationLaunchBalance, FoundationLaunchBalanceError, foundationLaunchBalanceError } from "@/lib/module-foundation/launch-balance";

export function useFoundationLaunchBalance(client: PublicClient, account: Address | undefined, chainName: string) {
  const reader = useMemo(() => account ? new FoundationLaunchBalance(() => client.getBalance({ address: account, blockTag: "latest" })) : undefined, [client, account]);
  const current = useRef(reader);
  current.current = reader;
  const [snapshot, setSnapshot] = useState<{ reader: FoundationLaunchBalance; value: bigint | undefined }>();
  const balance = snapshot?.reader === reader ? snapshot?.value : undefined;
  const balanceRef = useRef(balance);
  balanceRef.current = balance;

  const refresh = useCallback(async (force = false) => {
    const value = await reader?.read(force);
    if (reader && current.current === reader) setSnapshot({ reader, value });
    return value;
  }, [reader]);

  useEffect(() => {
    void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    // Detect deposits without requiring a page reload. Positive balances use the reader's short cache.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(balanceRef.current === 0n);
    }, 5_000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);

  const check = useCallback(async (initialBuy: string) => {
    // Recheck an insufficient balance so a deposit or reduced buy is usable immediately.
    const value = await refresh(Boolean(foundationLaunchBalanceError(balanceRef.current, initialBuy, chainName)));
    const error = foundationLaunchBalanceError(value, initialBuy, chainName);
    if (error) throw new FoundationLaunchBalanceError(error);
  }, [refresh, chainName]);

  return { balance, check };
}
