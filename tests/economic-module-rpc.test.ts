import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server, type RequestListener } from "node:http";
import { economicHttp, economicRpcFailure } from "../ops/economic-modules/rpc.mjs";

const sleeps = vi.hoisted(() => ({ fast: false, delays: [] as number[] }));
vi.mock("node:timers/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:timers/promises")>();
  return { ...original, setTimeout: async (ms: number, value: unknown, options: { signal?: AbortSignal }) => {
    if (sleeps.fast && ms >= 60_000) { sleeps.delays.push(ms); vi.setSystemTime(Date.now() + ms); return value; }
    return original.setTimeout(ms, value, options);
  } };
});
let server: Server;
afterEach(async () => { sleeps.fast = false; sleeps.delays = []; vi.useRealTimers(); server?.closeAllConnections(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); });
async function endpoint(handler: RequestListener) {
  server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing test port");
  return `http://127.0.0.1:${address.port}/private-provider-key`;
}

it("serializes concurrent requests with pacing and returns all responses", async () => {
  let active = 0, maximum = 0;
  const started = Date.now();
  const url = await endpoint((_request, response) => {
    maximum = Math.max(maximum, ++active);
    setTimeout(() => { active--; response.setHeader("content-type", "application/json"); response.end('{"jsonrpc":"2.0","id":1,"result":"0x1"}'); }, 10);
  });
  const transport = economicHttp(url, { intervalMs: 100 })({});
  expect(await Promise.all([1, 2, 3].map(() => transport.request({ method: "eth_chainId" })))).toEqual(["0x1", "0x1", "0x1"]);
  expect(maximum).toBe(1);
  expect(Date.now() - started).toBeGreaterThanOrEqual(190);
});

it.each(["90", new Date(Date.now() + 120_000).toUTCString()])("respects Retry-After %s even with a JSON-RPC error body and does not retry queued calls", async retryAfter => {
  let calls = 0;
  const url = await endpoint((_request, response) => {
    calls++; response.writeHead(429, { "content-type": "application/json", "retry-after": retryAfter });
    response.end('{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"rate limit exceeded"}}');
  });
  const transport = economicHttp(url, { maxRateRetries: 0 })({});
  const results = await Promise.allSettled([1, 2].map(() => transport.request({ method: "eth_chainId" })));
  expect(calls).toBe(1);
  for (const result of results) {
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw Error("Expected failure");
    const failure = economicRpcFailure(result.reason);
    expect(failure.reason).toBe("rpc-rate-limited");
    expect(failure.retryAfterMs).toBeGreaterThan(80_000);
    expect(JSON.stringify(failure)).not.toContain("private-provider-key");
  }
});

it("does not replay a failed raw transaction and sanitizes access failures", async () => {
  let calls = 0;
  const url = await endpoint((_request, response) => { calls++; response.writeHead(403); response.end("private-provider-key"); });
  const result = await economicHttp(url)({}).request({ method: "eth_sendRawTransaction", params: ["0x1234"] }).catch(error => error);
  expect(calls).toBe(1);
  expect(economicRpcFailure(result)).toEqual({ reason: "rpc-access-denied", retryAfterMs: 60_000 });
});

it("bounds stalled RPC requests and releases the request queue after failure", async () => {
  let calls = 0;
  const url = await endpoint((_request, response) => { if (++calls > 1) response.end('{"jsonrpc":"2.0","id":1,"result":"0x1"}'); });
  const transport = economicHttp(url, { timeout: 30, intervalMs: 0 })({});
  const failure = await transport.request({ method: "eth_chainId" }).catch(error => error);
  expect(economicRpcFailure(failure)).toEqual({ reason: "rpc-timeout", retryAfterMs: 60_000 });
  expect(await transport.request({ method: "eth_chainId" })).toBe("0x1");
  expect(calls).toBe(2);
});

it("aborts active discovery reads and queued work promptly during shutdown", async () => {
  const signal = new AbortController();
  let seen!: () => void;
  const received = new Promise<void>(resolve => { seen = resolve; });
  let calls = 0;
  const url = await endpoint(() => { calls++; seen(); });
  const transport = economicHttp(url, { signal: signal.signal })({});
  const done = Promise.allSettled([1, 2].map(() => transport.request({ method: "eth_chainId" })));
  await received;
  signal.abort();
  expect((await done).map(result => result.status)).toEqual(["rejected", "rejected"]);
  expect(calls).toBe(1);
});

it("finishes an interrupted read after Retry-After without restarting the discovery candidate", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  sleeps.fast = true;
  let calls = 0;
  const url = await endpoint((_request, response) => {
    if (++calls === 1) { response.writeHead(429, { "retry-after": "90" }); response.end(); }
    else response.end('{"jsonrpc":"2.0","id":1,"result":"0x1"}');
  });
  expect(await economicHttp(url)({}).request({ method: "eth_chainId" })).toBe("0x1");
  expect(calls).toBe(2);
  expect(sleeps.delays).toEqual([90_000]);
});

it("bounds repeated rate-limited reads and never retries rate-limited writes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  sleeps.fast = true;
  let calls = 0;
  const url = await endpoint((_request, response) => { calls++; response.writeHead(429); response.end(); });
  const failure = await economicHttp(url)({}).request({ method: "eth_chainId" }).catch(error => error);
  expect(economicRpcFailure(failure).reason).toBe("rpc-rate-limited");
  expect(calls).toBe(3);
  const writeFailure = await economicHttp(url)({}).request({ method: "eth_sendRawTransaction", params: ["0x1234"] }).catch(error => error);
  expect(economicRpcFailure(writeFailure).reason).toBe("rpc-rate-limited");
  expect(calls).toBe(4);
});
