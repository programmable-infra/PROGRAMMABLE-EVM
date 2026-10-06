import test from "node:test";
import assert from "node:assert/strict";
import { createReadOnlyRpc } from "./fork-rpc.mjs";

test("upstream denies transactions, signing and state changes before contacting a provider", async () => {
  let contacted = false;
  const rpc = createReadOnlyRpc("https://example.invalid", { fetchImpl: async () => { contacted = true; } });
  for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "personal_sign", "anvil_setBalance", "anvil_impersonateAccount"]) {
    await assert.rejects(rpc.request(method), /method denied/);
  }
  assert.equal(contacted, false);
});

test("request budget includes failed calls and concurrent calls cannot exceed it", async () => {
  let calls = 0;
  const rpc = createReadOnlyRpc("https://example.invalid", { maximumRequests: 2, fetchImpl: async () => {
    calls++; throw new Error("provider failure with private URL");
  } });
  await Promise.allSettled(Array.from({ length: 10 }, () => rpc.request("eth_chainId")));
  assert.equal(calls, 2);
  assert.equal(rpc.statistics().requests, 2);
});

test("HTTP bridge rejects batch and mutation requests without leaking upstream errors", async () => {
  let calls = 0;
  const rpc = createReadOnlyRpc("https://example.invalid/secret", { fetchImpl: async () => {
    calls++; return Response.json({ result: "0x1" });
  } });
  const server = await rpc.listen();
  try {
    const send = body => fetch(server.url, { method: "POST", body: JSON.stringify(body) });
    const read = { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] };
    assert.equal((await send([read])).status, 400);
    const denied = await send({ ...read, method: "eth_sendRawTransaction" });
    assert.equal(denied.status, 200);
    assert.equal((await denied.json()).error.code, -32601);
    assert.equal(calls, 0);
    const result = await send(read);
    assert.deepEqual(await result.json(), { jsonrpc: "2.0", id: 1, result: "0x1" });
    assert.equal(calls, 1);
  } finally { await server.close(); }
});
