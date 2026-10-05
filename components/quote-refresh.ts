/** A hidden tab does not need another executable price. Refresh once on return
 * if its last quote expired, without replaying missed polling intervals. */
export function scheduleVisibleQuoteRefresh(expiresAt: number, refresh: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  function schedule() {
    clearTimeout(timer);
    if (finished || document.visibilityState === "hidden") return;
    const remaining = expiresAt - Date.now();
    if (remaining > 0) {
      timer = setTimeout(schedule, remaining);
      return;
    }
    finished = true;
    document.removeEventListener("visibilitychange", schedule);
    refresh();
  }
  document.addEventListener("visibilitychange", schedule);
  schedule();
  return () => {
    finished = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", schedule);
  };
}
