import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), discover: vi.fn(),
  client: { getBlockNumber: vi.fn(async () => 10_000n) },
}));
vi.mock("node:child_process", () => ({ execFile: Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: mocks.execute }) }));
vi.mock("viem", async importOriginal => ({ ...await importOriginal<typeof import("viem")>(), createPublicClient: () => mocks.client }));
vi.mock("../ops/economic-modules/discovery", () => ({ discoverEconomicTargets: mocks.discover, ECONOMIC_DISCOVERY_MAX_BLOCKS: 5000n }));
import { run } from "../ops/economic-modules/service.js";

let directory: string, configFile: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "economic-preview-"));
  configFile = path.join(directory, "config.json");
  vi.stubEnv("SERVICE_TEST_RPC", "https://primary.example");
  vi.stubEnv("SERVICE_TEST_SECONDARY_RPC", "https://secondary.example");
  mocks.execute.mockResolvedValue({ stdout: JSON.stringify({ broadcast: false, checked: 0 }) });
  mocks.client.getBlockNumber.mockResolvedValue(1_000_000n);
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
    expect(first.discoveryBlock).toBe("160068");
    expect(first).toMatchObject({ caughtUp: false, pages: 32, confirmedHead: "999936", lagBlocks: "839868" });
    expect(second.discoveryBlock).toBe("320036");
    expect(mocks.discover.mock.calls[32][0].position).toEqual({ block: "160068", logIndex: Number.MAX_SAFE_INTEGER });
    expect(JSON.parse(await readFile(path.join(directory, "preview-health.json"), "utf8")).discoveryBlock).toBe("320036");
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
    expect(JSON.parse(await readFile(path.join(directory, "preview-registry.json"), "utf8")).position.block).toBe("160068");
    const recovered = await run([configFile, directory], "/unused-root");
    expect(recovered.discoveryBlock).toBe("320036");
    await expect(readFile(path.join(directory, "execution-journal.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it("saves each verified page before a later RPC failure and resumes that exact checkpoint", async () => {
  mocks.discover.mockImplementationOnce(async () => ({ targets: [], processed: 0, position: { block: "1099", logIndex: Number.MAX_SAFE_INTEGER } }));
  mocks.discover.mockRejectedValueOnce(new Error("RPC timeout"));
  await expect(run([configFile, directory], "/unused-root")).rejects.toThrow("RPC timeout");
  expect(JSON.parse(await readFile(path.join(directory, "preview-registry.json"), "utf8")).position.block).toBe("1099");
  expect(mocks.execute).not.toHaveBeenCalled();
  await run([configFile, directory], "/unused-root");
  expect(mocks.discover.mock.calls[2][0].position.block).toBe("1099");
});

it("finishes a dense final block before reporting caught up and rejects a regressed head", async () => {
  mocks.client.getBlockNumber.mockResolvedValue(164n);
  mocks.discover.mockResolvedValueOnce({ targets: [], processed: 8, position: { block: "100", logIndex: 7 } });
  const status = await run([configFile, directory], "/unused-root");
  expect(status).toMatchObject({ caughtUp: true, pages: 2, lagBlocks: "0", confirmedHead: "100" });
  mocks.client.getBlockNumber.mockResolvedValue(163n);
  await expect(run([configFile, directory], "/unused-root")).rejects.toThrow("behind the discovery checkpoint");
  expect(mocks.execute).toHaveBeenCalledTimes(1);
});

it("stops a non-advancing discovery page without executing targets", async () => {
  mocks.discover.mockResolvedValueOnce({ targets: [], processed: 0, position: { block: "100", logIndex: -1 } });
  await expect(run([configFile, directory], "/unused-root")).rejects.toThrow("did not advance");
  expect(mocks.execute).not.toHaveBeenCalled();
});
