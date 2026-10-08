"use client";

import { useEffect, useRef } from "react";

/** Status reads only. Never retries a wallet send or overlaps a slow request. */
export function useLaunchStatusPolling(scope: string, enabled: boolean,
  refresh: (signal: AbortSignal) => Promise<void> | void, intervalMs = 20_000) {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(() => void run(), intervalMs); };
    const run = async () => {
      if (stopped || active || document.visibilityState !== "visible") return;
      clearTimeout(timer);
      const controller = new AbortController(); active = controller;
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try { await latest.current(controller.signal); }
      catch { /* Keep the last verified state and retry the read. */ }
      finally {
        clearTimeout(timeout); active = null;
        if (!stopped) schedule();
      }
    };
    const resume = () => { if (document.visibilityState === "visible") void run(); };
    schedule();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      stopped = true; clearTimeout(timer); active?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [scope, enabled, intervalMs]);
}
