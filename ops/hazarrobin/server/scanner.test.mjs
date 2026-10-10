import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ foundation: vi.fn(), legacy: vi.fn(), checkpoint: vi.fn(), block: vi.fn() }));
vi.mock('./foundation.mjs', () => ({ createFoundationScanner: () => ({ scanFees: mocks.foundation, parseReleases: () => [] }) }));
vi.mock('./legacy-ethereum.mjs', () => ({ scanLegacyEthereum: mocks.legacy }));
vi.mock('./claimability.mjs', () => ({ executableClaims: async (_clients, claims) => ({ available: claims, blocked: [] }) }));
vi.mock('./rpc.mjs', async original => ({
  ...await original(), rpcClients: () => [{ getBlock: mocks.block }, {}], checkpoint: mocks.checkpoint, pin: async () => {},
}));
import { scanEcosystem } from './scanner.mjs';

const token = '0x1111111111111111111111111111111111111111';
const hook = '0x2222222222222222222222222222222222222222';
const unknown = '0x3333333333333333333333333333333333333333';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkpoint.mockResolvedValue({ number: 100n, hash: '0x1234' });
  mocks.block.mockResolvedValue({ hash: '0x1234' });
  mocks.legacy.mockResolvedValue({ claims: [], launches: [], unsupported: [{ hook }, { hook: unknown }], launchCount: 2 });
});
describe('source coverage during incomplete scans', () => {
  it('preserves discovered module identities when a later balance read fails', async () => {
    mocks.foundation.mockImplementation(async ({ onDiscovered }) => {
      onDiscovered([{ token, hook }]);
      throw new Error('Balance read unavailable');
    });
    const result = await scanEcosystem(1);
    expect(mocks.legacy.mock.calls[0][0].excludedTokens).toEqual(new Set([token]));
    expect(result.unsupported).toEqual([unknown]);
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual([{ source: 'Module Mode', message: 'Balance read unavailable' }]);
  });
  it('does not label unresolved sources unsupported when module discovery itself failed', async () => {
    mocks.foundation.mockRejectedValue(new Error('Discovery unavailable'));
    const result = await scanEcosystem(1);
    expect(result.unsupported).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.issues).toHaveLength(1);
  });
  it('still reports unknown adapters after successful source discovery', async () => {
    mocks.foundation.mockImplementation(async ({ onDiscovered }) => {
      onDiscovered([{ token, hook }]);
      return { claims: [], assets: [], launches: [{ token, hook }], launchCount: 1 };
    });
    const result = await scanEcosystem(1);
    expect(result.unsupported).toEqual([unknown]);
    expect(result.issues).toEqual([]);
  });
});
