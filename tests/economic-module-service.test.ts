import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), discover: vi.fn(),
  client: { getBlockNumber: vi.fn(async () => 10_000n) },
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.execute }));
vi.mock("viem", async importOriginal => ({ ...await importOriginal<typeof import("viem")>(), createPublicClient: () => mocks.client }));
vi.mock("../ops/economic-modules/discovery", () => ({ discoverEconomicTargets: mocks.discover }));
import { run } from "../ops/economic-modules/service.js";

let directory: string, configFile: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "economic-preview-"));
  configFile = path.join(directory, "config.json");
  vi.stubEnv("SERVICE_TEST_RPC", "https://primary.example");
  vi.stubEnv("SERVICE_TEST_SECONDARY_RPC", "https://secondary.example");
  mocks.execute.mockReturnValue(JSON.stringify({ broadcast: false, checked: 0 }));
  mocks.discover.mockImplementation(async ({ toBlock }) => ({
    targets: [], processed: 0, position: { block: String(toBlock), logIndex: Number.MAX_SAFE_INTEGER },
  }));
  await writeFile(configFile, JSON.stringify({
    execution: { chainId: 1, confirmations: 64, rpcEnv: "SERVICE_TEST_RPC", secondaryRpcEnv: "SERVICE_TEST_SECONDARY_RPC",
      keyEnv: "UNUSED_TEST_KEY", simulationAccount: "0x1000000000000000000000000000000000000000", maxFeePerGasWei: "1000000000", maxGasSpendPerDayWei: "1000000000000000" },
    discovery: { binding: { chainId: 1, startBlock: "100" }, startBlock: "100", admissions: [] },
  }));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.clearAllMocks();
});

describe("economic service preview discovery", () => {
  it("advances across pages using separate files and leaves live execution state untouched", async () => {
    const live = { "registry.json": "live registry", "execution-journal.json": "live pending transaction", "health.json": "live health" };
    for (const [name, value] of Object.entries(live)) await writeFile(path.join(directory, name), value);
    const first = await run([configFile, directory], "/unused-root");
    const second = await run([configFile, directory], "/unused-root");
    expect(first.discoveryBlock).toBe("1099");
    expect(second.discoveryBlock).toBe("2098");
    expect(mocks.discover.mock.calls[1][0].position).toEqual({ block: "1099", logIndex: Number.MAX_SAFE_INTEGER });
    expect(JSON.parse(await readFile(path.join(directory, "preview-health.json"), "utf8")).discoveryBlock).toBe("2098");
    for (const [name, value] of Object.entries(live)) expect(await readFile(path.join(directory, name), "utf8")).toBe(value);
    for (const [, args] of mocks.execute.mock.calls) {
      expect(args).not.toContain("--broadcast");
      expect(args).toContain("--preview-state");
      expect(args[1]).toBe(path.join(directory, "preview-execution.json"));
      expect(args[2]).toBe(path.join(directory, "preview-execution-journal.json"));
    }
  });

  it("retains the preview checkpoint on execution failure and releases its lock", async () => {
    mocks.execute.mockImplementationOnce(() => { throw new Error("provider unavailable"); });
    await expect(run([configFile, directory], "/unused-root")).rejects.toThrow("provider unavailable");
    expect(JSON.parse(await readFile(path.join(directory, "preview-registry.json"), "utf8")).position.block).toBe("1099");
    const recovered = await run([configFile, directory], "/unused-root");
    expect(recovered.discoveryBlock).toBe("2098");
    await expect(readFile(path.join(directory, "execution-journal.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
