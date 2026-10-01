import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import {
  createPublicClient, createWalletClient, defineChain, encodeAbiParameters, encodeFunctionData,
  getCreate2Address, http, keccak256, parseAbi, parseAbiParameters,
  parseEther, toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// This runner signs only on a verified loopback Anvil fork. It cannot target a public RPC.
const [rpc, keyFile, evidenceDir] = process.argv.slice(2);
if (!rpc || !keyFile || !evidenceDir) throw new Error("Usage: node contracts/scripts/test-launch-wallet-cap-fork.mjs <loopback RPC> <private wallet file> <evidence directory>");
const endpoint = new URL(rpc);
assert.equal(endpoint.protocol, "http:");
assert.equal(endpoint.hostname, "127.0.0.1");
assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600, "Wallet secret must have mode 0600");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { V4Planner, Actions, URVersion } = require("@uniswap/v4-sdk");
const { RoutePlanner, CommandType, UniversalRouterVersion } = require("@uniswap/universal-router-sdk");
const artifact = name => JSON.parse(fs.readFileSync(path.join(root, "contracts/out/launch-wallet-cap", `${name}.sol`, `${name}.json`)));
const capFactoryArtifact = artifact("LaunchWalletCapFactoryV1");
const capArtifact = artifact("LaunchWalletCapV1");
const quoteArtifact = artifact("WalletCapQuoteFixture");
const generated = path.join(root, "contracts/out/launch-wallet-cap/fork-helpers.cjs");
buildSync({ stdin: { contents: 'export { foundationFactoryNativeAbi } from "./lib/module-foundation/abi"; export { buildFoundationExactInput, buildFoundationNativeExactInput } from "./lib/module-foundation/route";', resolveDir: root, loader: "ts" }, outfile: generated, bundle: true, packages: "external", platform: "node", format: "cjs", logLevel: "silent" });
const { foundationFactoryNativeAbi, buildFoundationExactInput, buildFoundationNativeExactInput } = require(generated);
const chain = defineChain({ id: 4663, name: "Robinhood local fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const transport = http(rpc, { timeout: 120_000, retryCount: 0 });
const client = createPublicClient({ chain, transport, pollingInterval: 100 });
const node = await client.request({ method: "anvil_nodeInfo" });
assert.equal(await client.getChainId(), 4663);
assert.equal(node.forkConfig?.forkUrl, "https://rpc.mainnet.chain.robinhood.com");
assert.ok(Number.isSafeInteger(node.forkConfig.forkBlockNumber));
const account = privateKeyToAccount(JSON.parse(fs.readFileSync(keyFile, "utf8")).privateKey);
const wallet = createWalletClient({ account, chain, transport });
const FACTORY = "0x18cab14c69d0fe6df4a96256318b51c51c98da3f";
const DEPLOYER = "0x6fabd2b1d39989247df7cbcc5427aadcab487cf4";
const ROUTER = "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const pins = [
  [FACTORY, "0x049a3b673e341750ff94b7ba71f9b9e4ab8f9ef2756cdc072769b1bc2083f706"],
  [DEPLOYER, "0xf480e7f7242d590d1656d6efec70cfe64470d02dc768cad3721d0937066a0152"],
  [ROUTER, "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5"],
  [PERMIT2, "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca"],
];
for (const [address, hash] of pins) assert.equal(keccak256(await client.getCode({ address })), hash);
await client.request({ method: "anvil_setBalance", params: [account.address, toHex(parseEther("100"))] });
fs.mkdirSync(evidenceDir, { recursive: true });
const evidence = { schemaVersion: "programmable.launch-wallet-cap.fork-test.v1", execution: "signed-local-fork-transactions", mainnetBroadcast: false, realFundsUsed: false, rpc, forkBlockNumber: node.forkConfig.forkBlockNumber, wallet: account.address, routerUnmodified: true, pins, transactions: [], scenarios: [] };
const persist = () => fs.writeFileSync(path.join(evidenceDir, "fork-test.json"), JSON.stringify(evidence, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
const now = async () => (await client.getBlock()).timestamp;
async function send(label, request, expected = "success") {
  const hash = await wallet.sendTransaction({ ...request, gas: request.gas ?? 1_000_000n });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  evidence.transactions.push({ label, hash, status: receipt.status, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, contractAddress: receipt.contractAddress });
  persist();
  assert.equal(receipt.status, expected, label);
  console.log(`${label}: ${receipt.status}`);
  return receipt;
}
const call = (label, address, abi, functionName, args = [], extra = {}, expected = "success") => send(label, { to: address, data: encodeFunctionData({ abi, functionName, args }), ...extra }, expected);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function deposit() payable"]);
const permits = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]);
const hooks = parseAbi([
  "struct Descriptor { bytes32 moduleId; uint16 abiVersion; uint8 phases; uint8 resources; uint32 beforeGas; uint32 afterGas; uint32 actionGas; bool failOpenAfter; bytes32 exclusiveGroup; }",
  "struct Module { address instance; bytes32 codeHash; bytes32 configurationHash; Descriptor descriptor; }",
  "function moduleAt(uint256) view returns (Module)",
  "function moduleCount() view returns (uint256)",
]);
const fees = parseAbi(["function platformReceived() view returns (uint256)", "function creatorReceived() view returns (uint256)"]);
const execute = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const descriptorHash = "0x1bd5aa9a4e6ca7771b3946b1ad429fdc7d301f5774e341b9ccf53e1cdeb1ac75";
const capDeployment = await send("deploy-cap-factory", { data: capFactoryArtifact.bytecode.object, gas: 1_500_000n });
const capFactory = capDeployment.contractAddress;
const factoryHash = keccak256(await client.getCode({ address: capFactory }));
assert.equal(factoryHash, keccak256(capFactoryArtifact.deployedBytecode.object));
const quoteDeployment = await send("deploy-six-decimal-quote-fixture", { data: quoteArtifact.bytecode.object });
const quote6 = quoteDeployment.contractAddress;
await call("mint-local-quote", quote6, quoteArtifact.abi, "mint", [account.address, 1_000_000n * 10n ** 6n]);
await call("wrap-local-ETH", WETH, erc20, "deposit", [], { value: parseEther("1") });
for (const quote of [WETH, quote6]) {
  await call("approve-quote-permit2", quote, erc20, "approve", [PERMIT2, quote === WETH ? parseEther("1") : 1_000_000n * 10n ** 6n]);
  await call("approve-quote-router", PERMIT2, permits, "approve", [quote, ROUTER, quote === WETH ? parseEther("1") : 1_000_000n * 10n ** 6n, Number(await now()) + 86_400]);
}
const supply = 1_000_000_000n * 10n ** 18n;
let serial = 0;
async function launch(quote, capped, bps = 200, minutes = 3) {
  const native = quote === WETH;
  const label = `${native ? "ETH" : "quote6"}-${capped ? "cap" : "free"}`;
  const p = {
    metadata: { name: `Local fork ${label}`, symbol: "FORK", description: "Local fork only", imageURI: "https://example.com/local-fork.png", website: "", socialData: "0x" },
    quote, quoteDecimals: native ? 18 : 6, initialTick: 0, creatorFeeBps: 200,
    additionalQuoteAmount: 0n, initialBuyQuoteAmount: capped ? (native ? parseEther("0.00001") : 1n) : 0n,
    initialBuyMinimumTokenAmount: capped ? 1n : 0n, deadline: await now() + 300n,
    tokenSalt: toHex(++serial, { size: 32 }), hookSalt: toHex(0, { size: 32 }),
    modules: capped ? [{ factory: capFactory, factoryCodeHash: factoryHash, moduleCodeHash: keccak256(capArtifact.deployedBytecode.object), descriptorHash, configuration: encodeAbiParameters(parseAbiParameters("uint16,uint32"), [bps, minutes]), creatorShareBps: 0 }] : [],
  };
  const token = await read(FACTORY, foundationFactoryNativeAbi, "predictTokenAddress", [account.address, p.tokenSalt, p.metadata]);
  p.initialTick = (BigInt(quote) < BigInt(token) ? 1 : -1) * (native ? 240_000 : 420_000);
  const initHash = await read(FACTORY, foundationFactoryNativeAbi, "hookInitCodeHash", [account.address, token, p]);
  for (let salt = 0; ; salt++) {
    p.hookSalt = toHex(salt, { size: 32 });
    const hook = getCreate2Address({ from: DEPLOYER, salt: p.hookSalt, bytecodeHash: initHash });
    if ((BigInt(hook) & 0x3fffn) === 0x20ccn) break;
  }
  if (native) {
    const emptyPath = encodeAbiParameters(parseAbiParameters("(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[]"), [[]]);
    await call(`launch-${label}`, FACTORY, foundationFactoryNativeAbi, "launchWithEthRoute", [p, emptyPath], { gas: 9_000_000n, value: p.initialBuyQuoteAmount });
  } else {
    if (p.initialBuyQuoteAmount) await call("approve-initial-quote", quote, erc20, "approve", [FACTORY, p.initialBuyQuoteAmount]);
    await call(`launch-${label}`, FACTORY, foundationFactoryNativeAbi, "launch", [p], { gas: 9_000_000n });
  }
  const result = await read(FACTORY, foundationFactoryNativeAbi, "launchOf", [token]);
  const pool = { token, quote, hook: result.hook, poolId: result.poolId };
  assert.equal(await read(result.hook, hooks, "moduleCount"), capped ? 1n : 0n);
  const instance = capped ? (await read(result.hook, hooks, "moduleAt", [0n])).instance : null;
  if (instance) {
    assert.equal(keccak256(await client.getCode({ address: instance })), keccak256(capArtifact.deployedBytecode.object));
    assert.equal(await read(instance, capArtifact.abi, "purchasedTokens", [account.address]), result.initialBuyTokenAmount);
    assert.ok(result.initialBuyTokenAmount > 0n, "Creator first buy counted");
  }
  await call("approve-launched-token-permit2", token, erc20, "approve", [PERMIT2, supply]);
  await call("approve-launched-token-router", PERMIT2, permits, "approve", [token, ROUTER, supply, Number(await now()) + 86_400]);
  const scenario = { label, pool, module: instance, bps: capped ? bps : null, minutes: capped ? minutes : null, creatorFirstBuy: result.initialBuyTokenAmount, assertions: [] };
  evidence.scenarios.push(scenario);
  persist();
  return scenario;
}
async function exactOut(s, amount, expected = "success") {
  const inputBalance = await read(s.pool.quote, erc20, "balanceOf", [account.address]);
  const key = [s.pool.token, s.pool.quote].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  const v4 = new V4Planner();
  v4.addAction(Actions.SWAP_EXACT_OUT_SINGLE, [[[...key, 0, 60, s.pool.hook], s.pool.quote.toLowerCase() === key[0].toLowerCase(), amount.toString(), inputBalance.toString(), "0", "0x"]], URVersion.V2_1_1);
  v4.addAction(Actions.SETTLE_ALL, [s.pool.quote, inputBalance.toString()], URVersion.V2_1_1);
  v4.addAction(Actions.TAKE_ALL, [s.pool.token, amount.toString()], URVersion.V2_1_1);
  const route = new RoutePlanner();
  route.addCommand(CommandType.V4_SWAP, [v4.finalize()], false, UniversalRouterVersion.V2_1_1);
  return call(`buy-exact-output-${s.label}`, ROUTER, execute, "execute", [route.commands, route.inputs, await now() + 300n], {}, expected);
}
const counter = s => read(s.module, capArtifact.abi, "purchasedTokens", [account.address]);
const state = async s => Promise.all([counter(s), read(s.pool.token, erc20, "balanceOf", [account.address]), read(s.pool.quote, erc20, "balanceOf", [account.address]), read(s.pool.ledger, fees, "platformReceived"), read(s.pool.ledger, fees, "creatorReceived")]);
for (const [quote, bps, minutes] of [[WETH, 200, 3], [quote6, 50, 7]]) {
  const s = await launch(quote, true, bps, minutes);
  // Keep the ledger separate from the pool tuple used by the production route helper.
  s.pool.ledger = (await read(FACTORY, foundationFactoryNativeAbi, "launchOf", [s.pool.token])).ledger;
  const limit = supply * BigInt(bps) / 10_000n;
  const initial = await counter(s);
  await exactOut(s, limit / 2n);
  assert.equal(await counter(s), initial + limit / 2n);
  await exactOut(s, limit - await counter(s));
  assert.equal(await counter(s), limit);
  s.assertions.push("creator initial buy and split purchases reach the exact cumulative limit");
  const timestamp = await now();
  const sell = (quote === WETH ? buildFoundationNativeExactInput : buildFoundationExactInput)({ pool: s.pool, owner: account.address, recipient: account.address, side: "sell", amountIn: limit / 4n, minimumOutput: 1n, now: timestamp, deadline: timestamp + 300n });
  await send(`sell-${s.label}`, sell.transaction);
  assert.equal(await counter(s), limit);
  s.assertions.push("sell succeeds and does not reset the buy allowance");
  const before = await state(s);
  await exactOut(s, 1n, "reverted");
  assert.deepEqual(await state(s), before);
  const t = await now();
  const excess = (quote === WETH ? buildFoundationNativeExactInput : buildFoundationExactInput)({ pool: s.pool, owner: account.address, recipient: account.address, side: "buy", amountIn: quote === WETH ? 10n ** 12n : 10n, minimumOutput: 1n, now: t, deadline: t + 300n });
  await send(`excess-exact-input-${s.label}`, excess.transaction, "reverted");
  assert.deepEqual(await state(s), before);
  s.assertions.push("excess exact-output and exact-input buys revert without changing balances, fees or counters");
  const end = await read(s.module, capArtifact.abi, "protectionEndsAt");
  await client.request({ method: "evm_setNextBlockTimestamp", params: [Number(end)] });
  await client.request({ method: "evm_mine", params: [] });
  await exactOut(s, limit);
  assert.equal(await counter(s), limit);
  s.assertions.push("buy above the previous allowance succeeds after the configured expiry");
  persist();
  console.log(`${s.label}: lifecycle passed`);
}
for (const quote of [WETH, quote6]) {
  const s = await launch(quote, false);
  await exactOut(s, supply * 3n / 100n);
  s.assertions.push("with no cap module an immediate purchase above 2 percent succeeds");
  persist();
}
evidence.completed = true;
evidence.completedAt = new Date().toISOString();
persist();
console.log(JSON.stringify({ completed: true, scenarios: evidence.scenarios.length, transactions: evidence.transactions.length, mainnetBroadcast: false, realFundsUsed: false }));
