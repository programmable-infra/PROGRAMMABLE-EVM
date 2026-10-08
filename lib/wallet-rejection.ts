/** Recognize explicit wallet cancellation through bounded provider wrappers. */
export function errorIsExplicitWalletRejection(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<object>();
  // Provider and SDK wrappers commonly preserve the EIP-1193 rejection in cause/originalError.
  for (let index = 0; index < queue.length && index < 16; index++) {
    const value = queue[index];
    if (!value || typeof value !== "object" || Array.isArray(value) || seen.has(value)) continue;
    seen.add(value);
    const item = value as Record<string, unknown>;
    if (item.code === 4001 || item.code === "4001" || item.name === "UserRejectedRequestError" || item.walletRequestRejected === true
      || (typeof item.message === "string" && /user rejected|user denied/iu.test(item.message))) return true;
    queue.push(item.cause, item.error, item.data, item.originalError);
  }
  return false;
}

