import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { run } from "./service.js";

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
let status: { chainId: number; mode: string; ready: boolean; checkedAt: string | null; pass?: Pass } = {
  chainId: chain, mode: enabled ? "execution" : "preview", ready: false, checkedAt: null,
};
const health = () => ({ ...status,
  ready: status.ready && status.checkedAt !== null && Date.now() - Date.parse(status.checkedAt) <= 300_000,
});
const server = http.createServer((request, response) => {
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
    try {
      const pass = await run(args, root);
      status = { ...status, ready: !pass.execution.budgetExhausted, checkedAt: new Date().toISOString(), pass };
    } catch {
      status = { ...status, ready: false, checkedAt: new Date().toISOString() };
      console.error(JSON.stringify({ at: status.checkedAt, status: "pass-stopped", action: "inspect state and provider access" }));
    } finally { running = false; }
    fs.writeFileSync(path.join(directory, "service-health.json"), JSON.stringify(health()), { mode: 0o600 });
    if (stopped) break;
    try { await wait(60_000, undefined, { signal: stopWait.signal }); }
    catch (error) { if (!(error instanceof Error) || error.name !== "AbortError") throw error; }
  }
  server.close();
}
main().catch(() => { console.error("Economic worker stopped."); server.close(); process.exitCode = 1; });
