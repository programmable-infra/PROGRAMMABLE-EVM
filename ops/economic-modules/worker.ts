import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { run, writeDurable } from "./service.js";
import { economicRpcFailure } from "./rpc.mjs";

const chain = Number(process.env.ECONOMIC_CHAIN_ID);
if (![1, 4663].includes(chain)) throw Error("Choose one supported chain.");
const directory = process.env.ECONOMIC_STATE_DIRECTORY ?? "/data";
const root = process.env.ECONOMIC_ROOT ?? "/opt/programmable";
const configuration = process.env.ECONOMIC_CONFIG ?? `/etc/programmable/chain-${chain}.json`;
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
if (process.getuid?.() === 0) {
  fs.chownSync(directory, 1000, 1000);
  process.setgroups!([]); process.setgid!(1000); process.setuid!(1000);
}
process.env.ECONOMIC_RPC = chain === 1 ? process.env.ECONOMIC_ETH_RPC : process.env.ECONOMIC_RH_RPC;
process.env.ECONOMIC_SECONDARY_RPC = chain === 1 ? process.env.ECONOMIC_ETH_SECONDARY_RPC : process.env.ECONOMIC_RH_SECONDARY_RPC;
const enabled = process.env.ECONOMIC_EXECUTION_ENABLED === "true";
const args = [configuration, directory, ...(enabled ? ["--broadcast"] : [])];
type Pass = Awaited<ReturnType<typeof run>>;
let status: { chainId: number; mode: string; ready: boolean; checkedAt: string | null; pass?: Pass; failure?: { reason: string; retryAfterMs: number } } = {
  chainId: chain, mode: enabled ? "execution" : "preview", ready: false, checkedAt: null,
};
const health = () => ({ ...status,
  ready: status.ready && status.checkedAt !== null && Date.now() - Date.parse(status.checkedAt) <= 300_000,
});
const server = http.createServer((request, response) => {
  // Deployment/process liveness must not claim that historical discovery is complete.
  if (request.url === "/live") { response.writeHead(stopped ? 503 : 200); response.end(); return; }
  if (request.url !== "/health") { response.writeHead(404); response.end(); return; }
  const value = health();
  response.writeHead(value.ready ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}).listen(8080, "0.0.0.0");
let stopped = false, running = false;
const stopWait = new AbortController();
const stop = () => { stopped = true; stopWait.abort(); if (!running) server.close(); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);

async function main() {
  // Preview and execution both keep observing; each pass completes before the next begins.
  while (!stopped) {
    running = true;
    let delay = 60_000;
    try {
      const pass = await run(args, root, { signal: stopWait.signal });
      status = { chainId: chain, mode: status.mode, ready: pass.caughtUp && !pass.execution.budgetExhausted
        && !pass.execution.deferred && !(pass.execution.pendingAgeSeconds > 1800), checkedAt: new Date().toISOString(), pass };
      delay = pass.caughtUp ? 60_000 : 1_000;
    } catch (error) {
      const failure = economicRpcFailure(error);
      status = { ...status, ready: false, checkedAt: new Date().toISOString(), failure };
      delay = Math.max(delay, failure.retryAfterMs);
      console.error(JSON.stringify({ at: status.checkedAt, status: "pass-stopped", ...failure }));
    } finally { running = false; }
    await writeDurable(path.join(directory, "service-health.json"), health());
    if (stopped) break;
    try { await wait(Math.min(delay, 2_147_483_647), undefined, { signal: stopWait.signal }); }
    catch (error) { if (!(error instanceof Error) || error.name !== "AbortError") throw error; }
  }
  server.close();
}
main().catch(() => { console.error("Economic worker stopped."); server.close(); process.exitCode = 1; });
