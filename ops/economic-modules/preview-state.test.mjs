import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const account = "0x1000000000000000000000000000000000000000";
const runner = fileURLToPath(new URL("./run.mjs", import.meta.url));
async function fixture(t, initial) {
  const directory = await mkdtemp(path.join(tmpdir(), "economic-preview-journal-"));
  const methods = [];
  const server = http.createServer(async (request, response) => {
    let bytes = ""; for await (const part of request) bytes += part;
    const body = JSON.parse(bytes); methods.push(body.method);
    assert.ok(["eth_chainId", "eth_blockNumber", "eth_call", "eth_getCode"].includes(body.method));
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id,
      result: body.method === "eth_chainId" ? "0x1" : body.method === "eth_blockNumber" ? "0x100" : "0x" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const config = path.join(directory, "config.json"), journal = path.join(directory, "journal.json");
  const target = { family: "buyer-rewards", host: account, module: account, index: 0,
    runtimeHash: "0x" + "11".repeat(32), configurationHash: "0x" + "22".repeat(32), deployedBlock: "1" };
  await writeFile(config, JSON.stringify({ chainId: 1, confirmations: 64, rpcEnv: "PREVIEW_FIXTURE_RPC", keyEnv: "UNUSED_KEY",
    simulationAccount: account, maxFeePerGasWei: "1", maxGasSpendPerDayWei: "1", targets: [target] }));
  if (initial) await writeFile(journal, JSON.stringify(initial));
  const run = flags => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, config, journal, ...flags], {
      env: { ...process.env, PREVIEW_FIXTURE_RPC: `http://127.0.0.1:${server.address().port}` }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; child.stdout.on("data", value => { stdout += value; }); child.stderr.resume();
    child.once("error", reject); child.once("close", code => resolve({ code, stdout }));
  });
  return { run, journal, methods };
}

test("persistent preview refuses a live journal without modifying it", async t => {
  const initial = { chainId: 1, account, cursor: 9 };
  const f = await fixture(t, initial);
  assert.equal((await f.run(["--preview-state"])).code, 1);
  assert.deepEqual(JSON.parse(await readFile(f.journal, "utf8")), initial);
  assert.deepEqual(f.methods, ["eth_chainId"]);
});

test("persistent preview saves deferred work but never signs or sends", async t => {
  const f = await fixture(t);
  const result = await f.run(["--preview-state"]);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).broadcast, false);
  const journal = JSON.parse(await readFile(f.journal, "utf8"));
  assert.equal(journal.mode, "preview");
  assert.equal(Object.values(journal.targets)[0].failures, 1);
  assert.equal(journal.pending, undefined);
  assert.ok(f.methods.every(method => !method.includes("send") && !method.includes("sign")));
});

test("plain dry run preserves its supplied journal", async t => {
  const initial = { chainId: 1, account, cursor: 0 };
  const f = await fixture(t, initial);
  assert.equal((await f.run([])).code, 0);
  assert.deepEqual(JSON.parse(await readFile(f.journal, "utf8")), initial);
});
