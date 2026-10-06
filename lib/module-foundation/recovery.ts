/** Bounded read-only recovery. The caller still verifies the exact transaction before clearing its record. */
export function watchFoundationRecovery({ reconcile, visible }: {
  reconcile: () => Promise<unknown>;
  visible: () => boolean;
}) {
  const delays = [0, 5_000, 10_000, 20_000, 30_000];
  let cancelled = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(async () => {
      if (cancelled || !visible()) return;
      try { await reconcile(); }
      catch { if (!cancelled && ++attempt < delays.length) schedule(); }
    }, delays[attempt]);
  };
  schedule();
  return () => { cancelled = true; clearTimeout(timer); };
}
