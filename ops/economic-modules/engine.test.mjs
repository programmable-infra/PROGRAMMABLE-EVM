import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, stringToHex } from "viem";
import { runEconomicPass } from "./engine.mjs";
import { createExecutionAdapter, validateExecutionConfig } from "./run.mjs";

function fixture(overrides = {}) {
  const events = [], state = {};
  const adapter = {
    prepare: async target => { events.push(`prepare:${target.id}`); return { to: target.id }; },
    sign: async () => { events.push("sign"); return { raw: "0x1234", hash: "0xhash" }; },
    submit: async raw => events.push(`submit:${raw}`),
    receipt: async () => null,
    ...overrides,
  };
  const options = { targets: [{ id: "a" }, { id: "b" }], state, adapter, now: 100, broadcast: true,
    persist: async value => events.push(value.pending ? "persist:signed" : "persist:state") };
  return { options, events, state };
}

test("journals exact bytes before broadcasting and submits only one per chain", async () => {
  const f = fixture();
  const result = await runEconomicPass(f.options);
  assert.equal(result.submitted, 1);
  assert.deepEqual(f.events, ["prepare:a", "persist:state", "sign", "persist:signed", "submit:0x1234"]);
  assert.equal(f.state.pending.target, "a");
});

test("crash after signing retries identical bytes without preparing or signing again", async () => {
  const f = fixture({ submit: async () => { throw new Error("network lost"); } });
  await assert.rejects(runEconomicPass(f.options));
  const raw = f.state.pending.raw;
  f.events.length = 0;
  f.options.adapter.submit = async bytes => f.events.push(bytes);
  await runEconomicPass(f.options);
  assert.deepEqual(f.events, [raw]);
});

test("failed durable write never broadcasts", async () => {
  const f = fixture();
  f.options.persist = async state => { if (state.pending) throw new Error("disk unavailable"); };
  await assert.rejects(runEconomicPass(f.options));
  assert.equal(f.events.some(e => e.startsWith("submit:")), false);
});

test("dry run prepares but never signs or submits", async () => {
  const f = fixture();
  const result = await runEconomicPass({ ...f.options, broadcast: false });
  assert.equal(result.ready, 2);
  assert.equal(result.submitted, 0);
  assert.equal(f.events.includes("sign"), false);
});

test("failed targets back off without starving ready targets", async () => {
  const f = fixture({ prepare: async t => { if (t.id === "a") throw new Error("price not ready"); return { to: t.id }; } });
  const result = await runEconomicPass(f.options);
  assert.equal(result.deferred, 1);
  assert.equal(f.state.targets.a.nextAt, 220);
  assert.equal(f.state.pending.target, "b");
});

test("reverted confirmed receipts back off, confirmed success advances, and scanning is bounded", async () => {
  const f = fixture({ receipt: async () => ({ success: false }) });
  f.state.pending = { raw: "0xold", hash: "0xoldhash", target: "a" };
  const result = await runEconomicPass({ ...f.options, maxChecks: 1 });
  assert.equal(result.checked, 0);
  assert.equal(f.state.targets.a.nextAt, 3700);
  assert.equal(f.state.pending, undefined);
});

const address = "0x1111111111111111111111111111111111111111";
const code = "0x1234", runtimeHash = keccak256(code), configurationHash = keccak256("0xab");
const config = { chainId: 1, confirmations: 12, rpcEnv: "ECONOMIC_ETH_RPC", keyEnv: "ECONOMIC_KEY", maxFeePerGasWei: "100", simulationAccount: address,
  targets: [{ host: address, module: address, family: "buyer-rewards", index: 0, runtimeHash, configurationHash, deployedBlock: "10" }] };

test("requires supported chains, confirmations, known modules and unique bindings", () => {
  assert.equal(validateExecutionConfig(config).targets[0].kind, "rewards");
  for (const invalid of [{ ...config, chainId: 5 }, { ...config, confirmations: 0 }, { ...config, targets: [...config.targets, ...config.targets] },
    { ...config, targets: [{ ...config.targets[0], family: "leverage" }] }]) assert.throws(() => validateExecutionConfig(invalid));
});

function rpcFixture() {
  const calls = [];
  const bound = { instance: address, codeHash: runtimeHash, configurationHash, descriptor: { moduleId: keccak256(stringToHex("programmable.foundation.buyer-rewards.v1")) } };
  const client = {
    getBlockNumber: async () => 9000n,
    readContract: async args => { calls.push(args.functionName); return args.functionName === "moduleAt" ? bound : 20n; },
    getCode: async () => code,
    getBlock: async () => ({ hash: runtimeHash }),
    getLogs: async args => { calls.push(args); return [{ args: { beneficiary: address } }]; },
    call: async args => { calls.push(args); return { data: "0x" }; },
  };
  const normalized = validateExecutionConfig(config);
  const adapter = createExecutionAdapter({ config: normalized, client, wallet: {}, account: address });
  return { calls, client, bound, adapter, target: normalized.targets[0] };
}

test("payment discovery advances one bounded window and pays the recorded beneficiary", async () => {
  const f = rpcFixture(), entry = {};
  const tx = await f.adapter.prepare(f.target, entry);
  const logsCall = f.calls.find(c => c.fromBlock !== undefined);
  assert.equal(logsCall.fromBlock, 10n);
  assert.equal(logsCall.toBlock, 1009n);
  assert.equal(entry.scannedBlock, "1009");
  assert.deepEqual(entry.beneficiaries, [address]);
  assert.equal(tx.to, address);
});

test("runtime mismatch blocks a target before scanning logs or simulating", async () => {
  const f = rpcFixture();
  f.bound.codeHash = configurationHash;
  await assert.rejects(f.adapter.prepare(f.target, {}), /admitted/);
  assert.deepEqual(f.calls, ["moduleAt"]);
});

test("reorg replays from deployment and already paid debts are discarded", async () => {
  const f = rpcFixture();
  f.client.readContract = async args => args.functionName === "moduleAt" ? f.bound : 0n;
  const entry = { scannedBlock: "1000", scannedHash: configurationHash, beneficiaries: [address] };
  assert.equal(await f.adapter.prepare(f.target, entry), null);
  assert.equal(f.calls.find(c => c.fromBlock !== undefined).fromBlock, 10n);
  assert.deepEqual(entry.beneficiaries, []);
});

test("a busy queue drains before the next event scan", async () => {
  const f = rpcFixture();
  const entry = { beneficiaries: Array(5000).fill(address) };
  await f.adapter.prepare(f.target, entry);
  assert.equal(f.calls.some(c => c.fromBlock !== undefined), false);
});

test("a rejected reward batch switches to rotating single-recipient payments", async () => {
  const f = rpcFixture();
  const other = "0x2222222222222222222222222222222222222222";
  const entry = { beneficiaries: [address, other] };
  f.client.call = async () => { throw new Error("recipient rejected"); };
  await assert.rejects(f.adapter.prepare(f.target, entry));
  assert.equal(entry.singlePayments, true);
  await assert.rejects(f.adapter.prepare(f.target, entry));
  assert.equal(entry.beneficiaries[0], other);
  f.client.call = async () => ({ data: "0x" });
  assert.ok(await f.adapter.prepare(f.target, entry));
});

test("gas price ceiling prevents signing", async () => {
  const normalized = validateExecutionConfig(config);
  const adapter = createExecutionAdapter({ config: normalized, client: {}, wallet: { prepareTransactionRequest: async () => ({ maxFeePerGas: 101n }) },
    account: { signTransaction: () => { throw new Error("should not sign"); } } });
  await assert.rejects(adapter.sign({}), /ceiling/);
});
