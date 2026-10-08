import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({ ethereum: vi.fn(), robinhood: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumExploreCatalog: readers.ethereum }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodExploreCatalog: readers.robinhood }));

import { createOperationsHealthReader } from "../lib/server/operations-health";
import { programmablePublicOpenApi } from "../lib/public-openapi";

const NOW = "2026-10-08T02:00:00.000Z";
const UPDATED = "2026-10-08T01:59:50.000Z";
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(programmablePublicOpenApi.components.schemas.OperationsHealth);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  readers.ethereum.mockReset().mockResolvedValue({ status: "ready", updatedAt: UPDATED, entries: [] });
  readers.robinhood.mockReset().mockResolvedValue({ status: "ready", updatedAt: UPDATED, items: [] });
});
afterEach(() => { vi.useRealTimers(); });

async function getHealth() {
  const { GET } = await import("../app/api/ops/health/route");
  const response = await GET();
  const body = await response.json();
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-programmable-indexing-status")).toBe(body.status);
  return { response, body };
}

describe("observed website indexing health", () => {
  it("reports current empty catalogs and separate provider and Custom Launch readiness", async () => {
    const { response, body } = await getHealth();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ schemaVersion: "programmable.operations-health.v2",
      scope: "website-launch-indexes", status: "ready", checkedAt: NOW,
      indexes: [{ chainId: 1, status: "ready", updatedAt: UPDATED }, { chainId: 4663, status: "ready", updatedAt: UPDATED }],
      providers: [{ name: "codex", health: "not-checked" }],
    });
    expect(body.customLaunchReadiness).toEqual([
      { chainId: 1, readinessUrl: "https://api.programmable.market/readyz", capabilitiesUrl: "https://api.programmable.market/v3/capabilities" },
      { chainId: 4663, readinessUrl: "https://api.programmable.market/v4/chains/4663/custom-launch-plans/readiness",
        capabilitiesUrl: "https://api.programmable.market/v4/chains/4663/custom-launch-capabilities" },
    ]);
    expect(readers.ethereum).toHaveBeenCalledTimes(1);
    expect(readers.robinhood).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["partial", "ready"], ["ready", "syncing"], ["stale", "ready"], ["ready", "unavailable"],
  ])("preserves %s/%s as degraded, rather than healthy", async (ethereum, robinhood) => {
    readers.ethereum.mockResolvedValue({ status: ethereum, updatedAt: UPDATED });
    readers.robinhood.mockResolvedValue({ status: robinhood, updatedAt: robinhood === "unavailable" ? null : UPDATED });
    const { response, body } = await getHealth();
    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.indexes.map((index: { status: string }) => index.status)).toEqual([ethereum, robinhood]);
  });

  it("returns 503 for two failed readers without exposing private errors", async () => {
    readers.ethereum.mockRejectedValue(new Error("private provider credential"));
    readers.robinhood.mockRejectedValue(new Error("private database endpoint"));
    const { response, body } = await getHealth();
    expect(response.status).toBe(503);
    expect(body.status).toBe("unavailable");
    expect(body.indexes.every((index: { status: string; updatedAt: unknown }) => index.status === "unavailable" && index.updatedAt === null)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("private");
  });

  it("bounds a stalled chain read and retains the available chain", async () => {
    const read = createOperationsHealthReader({ ethereum: () => new Promise(() => {}), robinhood: readers.robinhood });
    const pending = read();
    await vi.advanceTimersByTimeAsync(5_000);
    const body = await pending;
    expect(body.status).toBe("degraded");
    expect(body.indexes.map(index => index.status)).toEqual(["unavailable", "ready"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces reads and refreshes after the observation cache expires", async () => {
    let resolveEthereum!: (value: { status: "ready"; updatedAt: string }) => void;
    readers.ethereum.mockImplementationOnce(() => new Promise(resolve => { resolveEthereum = resolve; }));
    const read = createOperationsHealthReader(readers);
    const first = read(), concurrent = read();
    resolveEthereum({ status: "ready", updatedAt: UPDATED });
    const body = await first;
    expect(await concurrent).toBe(body);
    expect(await read()).toBe(body);
    expect(readers.ethereum).toHaveBeenCalledTimes(1);
    expect(readers.robinhood).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    readers.ethereum.mockResolvedValue({ status: "stale", updatedAt: UPDATED });
    const refreshed = await read();
    expect(refreshed.status).toBe("degraded");
    expect(refreshed.checkedAt).not.toBe(body.checkedAt);
    expect(readers.ethereum).toHaveBeenCalledTimes(2);
  });

  it("documents both HTTP outcomes and rejects the reset payload and unmeasured healthy-provider claims", async () => {
    const { body } = await getHealth();
    const operation = programmablePublicOpenApi.paths["/api/ops/health"].get;
    expect(Object.keys(operation.responses)).toEqual(["200", "503"]);
    expect(operation.description).toContain("simulator availability");
    expect(validate({ status: "index-reset", providers: [] })).toBe(false);
    expect(validate({ ...body, providers: [{ ...body.providers[0], health: "healthy" }] })).toBe(false);
    expect(validate({ ...body, customLaunchReadiness: [{ ...body.customLaunchReadiness[0], readinessUrl: body.indexes[0].catalogUrl }, body.customLaunchReadiness[1]] })).toBe(false);
  });
});
