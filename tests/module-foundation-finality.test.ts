import { describe, expect, it, vi } from "vitest";
import { toHex, type PublicClient } from "viem";
import { assertFoundationLaunchFinality } from "@/lib/module-foundation/finality";

describe("Foundation launch discovery finality", () => {
  const block = vi.fn();
  const client = { getBlock: block } as unknown as PublicClient;
  it("uses the Ethereum confirmation threshold, without extra polling", async () => {
    block.mockClear();
    await assertFoundationLaunchFinality(client, 1, 100n, 163n);
    expect(block).not.toHaveBeenCalled();
    block.mockResolvedValue({ number: 99n, hash: toHex(1, { size: 32 }) });
    await expect(assertFoundationLaunchFinality(client, 1, 100n, 162n)).rejects.toThrow("waiting for Ethereum finality");
    expect(block).toHaveBeenCalledTimes(1);
  });
  it("accepts finalized history and rejects impossible finalized checkpoints", async () => {
    block.mockResolvedValue({ number: 100n, hash: toHex(1, { size: 32 }) });
    await assertFoundationLaunchFinality(client, 1, 100n, 110n);
    block.mockResolvedValue({ number: 111n, hash: toHex(1, { size: 32 }) });
    await expect(assertFoundationLaunchFinality(client, 1, 100n, 110n)).rejects.toThrow();
    await expect(assertFoundationLaunchFinality(client, 1, 111n, 110n)).rejects.toThrow("observed chain history");
  });
  it("preserves Robinhood's existing independent finality path", async () => {
    block.mockClear();
    await assertFoundationLaunchFinality(client, 4663, 100n, 100n);
    expect(block).not.toHaveBeenCalled();
  });
});
