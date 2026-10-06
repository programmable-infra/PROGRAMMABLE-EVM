import { afterEach, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const mocks = vi.hoisted(() => ({
  run: vi.fn(), write: vi.fn(), close: vi.fn(), handler: null as null | ((req: IncomingMessage, res: ServerResponse) => void),
}));
vi.mock("../ops/economic-modules/service.js", () => ({ run: mocks.run, writeDurable: mocks.write }));
vi.mock("node:fs", () => ({ default: { mkdirSync: vi.fn(), writeFileSync: mocks.write } }));
vi.mock("node:http", () => ({ default: { createServer: (handler: typeof mocks.handler) => {
  mocks.handler = handler; return { listen: () => ({ close: mocks.close }) };
} } }));
vi.mock("node:timers/promises", () => ({ setTimeout: (ms: number, _: unknown, { signal }: { signal: AbortSignal }) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("stop"), { name: "AbortError" })); }, { once: true });
  }),
}));
const initialTermListeners = process.listeners("SIGTERM");
const initialIntListeners = process.listeners("SIGINT");
afterEach(() => {
  for (const listener of process.listeners("SIGTERM")) if (!initialTermListeners.includes(listener)) process.removeListener("SIGTERM", listener);
  for (const listener of process.listeners("SIGINT")) if (!initialIntListeners.includes(listener)) process.removeListener("SIGINT", listener);
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
});

it("keeps previewing after success, reports failures and stale health, and shuts down cleanly", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
  vi.stubEnv("ECONOMIC_CHAIN_ID", "1"); vi.stubEnv("ECONOMIC_EXECUTION_ENABLED", "false");
  vi.spyOn(process, "getuid").mockReturnValue(1000);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.run.mockResolvedValue({ execution: { broadcast: false }, targets: 7, discoveryBlock: "123", caughtUp: true });
  await import("../ops/economic-modules/worker");
  await vi.advanceTimersByTimeAsync(0);
  const readHealth = (url = "/health") => {
    const response = { writeHead: vi.fn(), end: vi.fn() };
    mocks.handler!({ url } as IncomingMessage, response as unknown as ServerResponse);
    return { code: response.writeHead.mock.calls[0][0], body: response.end.mock.calls[0][0] ? JSON.parse(response.end.mock.calls[0][0]) : null };
  };
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(readHealth()).toMatchObject({ code: 200, body: { mode: "preview", ready: true } });
  mocks.run.mockRejectedValueOnce(new Error("provider unavailable"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.run).toHaveBeenCalledTimes(2);
  expect(readHealth()).toMatchObject({ code: 503, body: { ready: false } });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.run).toHaveBeenCalledTimes(3);
  expect(readHealth().code).toBe(200);
  mocks.run.mockResolvedValueOnce({ execution: { broadcast: false }, caughtUp: false, lagBlocks: "10000" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(readHealth().code).toBe(503);
  expect(readHealth("/live").code).toBe(200);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(readHealth().code).toBe(200);
  let finish!: (value: unknown) => void;
  mocks.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(readHealth("/live").code).toBe(200);
  vi.setSystemTime(new Date("2026-10-06T00:10:00Z"));
  expect(readHealth()).toMatchObject({ code: 503, body: { ready: false } });
  for (const [args] of mocks.run.mock.calls) expect(args).not.toContain("--broadcast");
  const stop = process.listeners("SIGTERM").find(listener => !initialTermListeners.includes(listener))!;
  stop("SIGTERM");
  expect(readHealth("/live").code).toBe(503);
  finish({ caughtUp: true, execution: { broadcast: false } });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.close).toHaveBeenCalled();
});
