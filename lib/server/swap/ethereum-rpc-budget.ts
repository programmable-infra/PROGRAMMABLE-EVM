export class EthereumRpcBudgetBusy extends Error {
  constructor() { super("Ethereum RPC checks are busy."); this.name = "EthereumRpcBudgetBusy"; }
}

export class EthereumRpcProviderRateLimit extends Error {
  readonly status = 429;
  constructor() { super("Ethereum RPC provider rate limit."); this.name = "EthereumRpcProviderRateLimit"; }
}

type WaitingRead = { resolve: () => void; reject: (error: Error) => void; expires: number };

/** Bound starts across preparations sharing a provider. Batching still consumes
 * one provider request per RPC call; it does not remove a provider's rate limit. */
export class EthereumRpcBudget {
  private readonly starts: number[] = [];
  private readonly waiting: WaitingRead[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pausedUntil = 0;
  constructor(private readonly now = () => performance.now()) {}

  acquire(): Promise<void> {
    if (this.waiting.length >= 64) return Promise.reject(new EthereumRpcBudgetBusy());
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject, expires: this.now() + 10_000 });
      this.pump();
    });
  }

  pause(): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + 1_100);
    this.pump();
  }

  private pump(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const now = this.now();
    while (this.starts.length && this.starts[0]! <= now - 1_050) this.starts.shift();
    while (this.waiting.length && this.waiting[0]!.expires <= now) this.waiting.shift()!.reject(new EthereumRpcBudgetBusy());
    while (this.waiting.length && this.pausedUntil <= now && this.starts.length < 16) {
      this.starts.push(now);
      this.waiting.shift()!.resolve();
    }
    if (!this.waiting.length) return;
    const capacityAt = this.starts.length < 16 ? now : this.starts[0]! + 1_050;
    const next = Math.min(Math.max(capacityAt, this.pausedUntil), this.waiting[0]!.expires);
    this.timer = setTimeout(() => this.pump(), Math.max(1, Math.ceil(next - now)));
  }
}

/** Inspect structured provider errors only. Never expose their messages, URLs,
 * credentials or body in the public preparation response. */
export function ethereumRpcRateLimited(error: unknown): boolean {
  let item = error;
  for (let depth = 0; depth < 6 && item && typeof item === "object"; depth++) {
    const value = item as { status?: unknown; code?: unknown; cause?: unknown };
    if (value.status === 429 || value.code === -32007) return true;
    item = value.cause;
  }
  return false;
}
