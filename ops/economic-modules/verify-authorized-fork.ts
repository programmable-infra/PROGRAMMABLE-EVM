import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import {
  createPublicClient, custom, encodeAbiParameters, encodeFunctionData, getAddress,
  keccak256, parseAbi, parseAbiParameters, toHex, type Address, type Hex,
} from "viem";
import { encodeFoundationParameters, foundationFactoryV2Abi, type FoundationContractModule,
  type FoundationLaunchParametersV3 } from "../../lib/module-foundation/abi";
import { buildFoundationEthereumGraph, assertFoundationEthereumTransaction, predictFoundationEthereumAccounts } from "../../lib/module-foundation/ethereum-graph-builder";
import { encodeFoundationFundingPath } from "../../lib/module-foundation/funding-path";
import { ETHEREUM_MODULE_SOURCE } from "../../lib/module-foundation/ethereum-release";
import { parseEthereumModuleAuthorization, type EthereumModuleAuthorizationRequest } from "../../lib/module-foundation/ethereum-authorization";
import ethereum from "../../contracts/spec/module-foundation/chain-1.v1.json";
import { createReadOnlyRpc } from "./fork-rpc.mjs";

const families = ["buyback-burn", "dip-buyback", "lp-rewards", "full-range-lp", "buyer-rewards",
  "nth-buy-pot", "king-of-the-hill", "hot-potato", "plague", "reactive-pair", "entangled"];
const origin = "https://programmable.market";
const source = ETHEREUM_MODULE_SOURCE;
const weth = getAddress(ethereum.contracts.wrappedEth.address);
const permit2 = getAddress(ethereum.contracts.permit2.address);
const router = getAddress(ethereum.contracts.universalRouter.address);
const stamp = getAddress(ethereum.canonicalStamp.router.address);
const tokenAbi = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)", "function deposit() payable"]);
const stampAbi = parseAbi([
  "function launchIdByToken(address) view returns (bytes32)",
  "function launchStamp(bytes32) view returns ((uint8 kind,address launchWallet,address token,address hook,address poolManager,bytes32 poolId,bytes32 poolKeyHash,bytes32 componentSetHash,bytes32 routePayloadHash,address routeLauncher,bytes32 routeLauncherRuntimeCodeHash,bytes32 expectedResultHash,bytes32 permitDigest,bytes32 stampHash))",
]);
const hostAbi = parseAbi([
  "struct Descriptor { bytes32 moduleId; uint16 abiVersion; uint8 phases; uint8 resources; uint32 beforeGas; uint32 afterGas; uint32 actionGas; bool failOpenAfter; bytes32 exclusiveGroup; }",
  "struct Module { address instance; bytes32 codeHash; bytes32 configurationHash; Descriptor descriptor; }",
  "function moduleAt(uint256) view returns (Module)", "function moduleCount() view returns (uint256)",
  "function executeModuleAction(uint256,bytes)", "function initializer() view returns (address)", "function quote() view returns (address)",
]);
const moduleAbi = parseAbi(["function totalQuoteUsed() view returns (uint256)", "function pausedUntil() view returns (uint256)"]);
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(`Probe: ${label}`); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const write = (path: string, data: unknown) => writeFile(path, JSON.stringify(data, (_, v) => typeof v === "bigint" ? String(v) : v, 2) + "\n", { mode: 0o600 });

function configuration(kind: number, reference: Address): Hex {
  if (kind < 4) return encodeAbiParameters(parseAbiParameters("uint128,uint128,uint32,uint32,uint16,uint16"),
    [1n, 10_000_000_000_000n, 30, 300, 500, kind === 1 ? 500 : 0]);
  if (kind < 7) return encodeAbiParameters(parseAbiParameters("uint128,uint16,uint32,uint32"),
    [1n, kind === 4 ? 100 : 0, kind === 5 ? 2 : 0, kind === 6 ? 300 : 0]);
  if (kind < 9) return encodeAbiParameters(parseAbiParameters("uint128,uint32"), [1n, kind === 7 ? 60 : 0]);
  return encodeAbiParameters(parseAbiParameters("address,uint16,uint16,uint16,uint16"),
    [reference, kind === 9 ? 100 : 0, kind === 9 ? 10 : 0, kind === 9 ? 500 : 0, kind === 10 ? 100 : 0]);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r, j) => server.close(e => e ? j(e) : r()));
  return port;
}

/** All state changes target an owned, disposable Anvil process. No private signing key is read. */
export async function run(args: string[], root: string) {
  check(args.length >= 4 && args.length <= 5, "usage RELEASE OUTPUT SESSION_JSON REFERENCE_TOKEN optional-families");
  const [releaseInput, outputInput, sessionPath, referenceTokenInput, familyFilter] = args;
  const selectedFamilies = familyFilter ? familyFilter.split(",") : families;
  check(selectedFamilies.every(family => families.includes(family)) && new Set(selectedFamilies).size === selectedFamilies.length, "unknown or repeated family");
  const output = resolve(outputInput), release = resolve(releaseInput);
  await mkdir(output, { recursive: false, mode: 0o700 });
  const primaryUrl = process.env.FOUNDATION_ETHEREUM_RPC_URL;
  const secondaryUrl = process.env.FOUNDATION_ETHEREUM_SECONDARY_RPC_URL;
  check(primaryUrl && secondaryUrl && new URL(primaryUrl).host !== new URL(secondaryUrl).host, "two independent Ethereum providers required");
  const primary = createReadOnlyRpc(primaryUrl), secondary = createReadOnlyRpc(secondaryUrl, { maximumRequests: 250 });
  const upstream = await primary.listen();
  const port = await freePort(), localUrl = `http://127.0.0.1:${port}`;
  const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "1", "--silent"],
    { stdio: "ignore" });
  let spawnFailed = false;
  child.once("error", () => { spawnFailed = true; });
  const local = async (method: string, params: unknown[] = []) => {
    check(!spawnFailed && child.exitCode === null && child.signalCode === null, "owned fork process stopped");
    const response = await fetch(localUrl, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(60000) });
    const body = await response.json();
    if (body.error) {
      if (method.startsWith("anvil_") || method.startsWith("evm_")) {
        const message = String(body.error.message ?? "").replace(/https?:\/\/\S+/g, "URL").slice(0, 160);
        await write(join(output, "local-control-error.json"), { method, code: body.error.code, message });
      }
      throw new Error("Probe: local RPC call reverted");
    }
    return body.result;
  };
  const client = createPublicClient({ transport: custom({ request: ({ method, params }) => local(method, params as unknown[]) }), cacheTime: 0 });
  const remote = createPublicClient({ transport: custom({ request: ({ method, params }) => primary.request(method, params) }), cacheTime: 0 });
  const cases: Record<string, unknown>[] = [];
  const report: Record<string, unknown> = { schemaVersion: "programmable.authorized-economic-fork.v1",
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    startedAt: new Date().toISOString(), simulationOnly: true, mainnetTransactionsSent: 0,
    authorizationMode: "production-website", signatureStubbed: false, implementationReplaced: false, cases,
    limitation: "Does not verify mainnet mining, index publication, real fee execution or economic worker availability." };
  let active: Record<string, unknown> | undefined;
  try {
    for (let i = 0; i < 50; i++) {
      try { check(String(await local("web3_clientVersion")).includes("anvil"), "unexpected fork client"); break; }
      catch { if (i === 49) throw new Error("Probe: owned fork failed to start"); await sleep(100); }
    }
    check(await primary.request("eth_chainId") === "0x1" && await secondary.request("eth_chainId") === "0x1", "wrong upstream chain");
    // Catch local harness and read-bridge problems before spending a production authorization request.
    const preflightBlock = await remote.getBlock();
    await local("anvil_reset", [{ forking: { jsonRpcUrl: upstream.url, blockNumber: Number(preflightBlock.number) } }]);
    check((await client.getBlock()).hash === preflightBlock.hash && await client.getChainId() === 1, "fork preflight mismatch");
    const referenceToken = getAddress(referenceTokenInput);
    const referenceId = await remote.readContract({ address: stamp, abi: stampAbi, functionName: "launchIdByToken", args: [referenceToken] });
    const reference = await remote.readContract({ address: stamp, abi: stampAbi, functionName: "launchStamp", args: [referenceId] });
    check(reference.token.toLowerCase() === referenceToken.toLowerCase() && BigInt(reference.hook) !== 0n, "reference must be an existing stamped token");
    check(getAddress(await remote.readContract({ address: reference.hook, abi: hostAbi, functionName: "quote" })) === weth, "reference quote must be WETH");

    for (const [kind, family] of families.entries()) {
      if (!selectedFamilies.includes(family)) continue;
      active = { family, status: "running", phase: "build" }; cases.push(active);
      await write(join(output, "result.json"), report);
      console.log(`Checking ${family}: real authorization, local execution`);
      const session = await json(sessionPath);
      const account = getAddress(session.walletAddress);
      const publication = await json(join(release, "runs", family, "1", "publication.json"));
      check(publication.release.chainId === 1 && publication.protocolReleaseDigest === source.releaseDigest, "publication host mismatch");
      const selection: FoundationContractModule = { ...publication.release, configuration: configuration(kind, reference.hook), creatorShareBps: kind < 7 ? 10000 : 0 };
      const latest = await remote.getBlock();
      const parameters: FoundationLaunchParametersV3 = {
        metadata: { name: "Economic local fork check", symbol: `EF${kind}`, description: "Local simulation only",
          imageURI: "https://programmable.market/favicon.ico", website: origin, socialData: "0x" },
        quote: weth, quoteDecimals: 18, initialTick: 120000, creatorBuyFeeBps: kind < 7 ? 1000 : 0,
        creatorSellFeeBps: kind < 7 ? 1000 : 0, additionalQuoteAmount: 0n, initialBuyQuoteAmount: 0n,
        initialBuyMinimumTokenAmount: 0n, deadline: latest.timestamp + 300n,
        tokenSalt: toHex(randomBytes(32)), hookSalt: toHex(0, { size: 32 }), modules: [selection],
      };
      const predicted = predictFoundationEthereumAccounts({ source, account, tokenSalt: parameters.tokenSalt, metadata: parameters.metadata });
      parameters.initialTick = BigInt(weth) < BigInt(predicted.token) ? 120000 : -120000;
      const graph = await buildFoundationEthereumGraph({ source, account, parameters, fundingPath: [], value: 0n });
      const request: EthereumModuleAuthorizationRequest = { schemaVersion: "programmable.ethereum-module-authorization-request.v1",
        chainId: "1", launchWallet: account, releaseDigest: source.releaseDigest,
        parameters: encodeFoundationParameters(graph.parameters), fundingPath: encodeFoundationFundingPath([], 1), valueWei: "0" };
      active.phase = "authorize";
      const began = performance.now();
      const response = await fetch(`${origin}/api/module-foundation/authorize`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: origin,
          Authorization: `Bearer ${session.token}`, ...(session.identityToken ? { "X-Privy-Identity-Token": session.identityToken } : {}) },
        body: JSON.stringify(request), redirect: "error", signal: AbortSignal.timeout(95000),
      });
      const data = await response.json();
      active.authorizationMs = Math.round(performance.now() - began);
      if (!response.ok) {
        active.httpStatus = response.status;
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter && /^\d+$/.test(retryAfter)) {
          active.retryAfterSeconds = Number(retryAfter);
          active.retryNotBefore = new Date(Date.now() + Number(retryAfter) * 1000).toISOString();
        }
        active.publicErrorCode = typeof data.code === "string" && /^[A-Za-z0-9_-]+$/.test(data.code) ? data.code : "unknown";
        if (response.status === 429) {
          active.status = "deferred";
          report.remainingFamilies = selectedFamilies.filter(f => !cases.some(c => c.family === f && c.status === "passed"));
        }
        throw new Error(`Probe: authorization HTTP ${response.status}`);
      }
      const authorized = parseEthereumModuleAuthorization(data, request);
      active.realAuthorizationReceived = true;
      const tx = authorized.transaction;
      await assertFoundationEthereumTransaction({ source, transaction: { from: tx.from, to: tx.to, data: tx.calldata, value: BigInt(tx.valueWei) } });
      active.phase = "fork";
      const tag = toHex(BigInt(authorized.simulation.blockNumber));
      const blocks = await Promise.all([primary.request<{ hash: Hex; timestamp: Hex }>("eth_getBlockByNumber", [tag, false]), secondary.request<{ hash: Hex; timestamp: Hex }>("eth_getBlockByNumber", [tag, false])]);
      check(blocks.every(b => b.hash === authorized.simulation.blockHash), "authorization checkpoint differs between providers");
      for (const identity of [source.implementation, ethereum.canonicalStamp.router, ethereum.canonicalStamp.graphFactory,
        { address: selection.factory, runtimeCodeHash: selection.factoryCodeHash }]) {
        const codes = await Promise.all([primary.request<Hex>("eth_getCode", [identity.address, tag]), secondary.request<Hex>("eth_getCode", [identity.address, tag])]);
        check(codes.every(code => keccak256(code) === identity.runtimeCodeHash), "published runtime mismatch");
      }
      await local("anvil_reset", [{ forking: { jsonRpcUrl: upstream.url, blockNumber: Number(BigInt(authorized.simulation.blockNumber)) } }]);
      await local("anvil_setBalance", [account, toHex(10n ** 20n)]);
      await local("anvil_impersonateAccount", [account]);
      if (Number(authorized.validAfter) > Number(BigInt(blocks[0].timestamp))) await local("evm_setNextBlockTimestamp", [Number(authorized.validAfter)]);
      const send = async (to: Address, calldata: Hex, value = 0n, gas = 16_777_216n) => {
        const hash = await local("eth_sendTransaction", [{ from: account, to, data: calldata, value: toHex(value), gas: toHex(gas) }]) as Hex;
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 30000, pollingInterval: 250, retryCount: 0 });
        if (receipt.status !== "success") {
          const trace = await local("debug_traceTransaction", [hash, { disableMemory: true, disableStack: true, disableStorage: true }]);
          await write(join(output, "local-revert.json"), { family, phase: active?.phase, hash, gasUsed: receipt.gasUsed, returnValue: trace.returnValue });
        }
        check(receipt.status === "success", "local transaction reverted");
        return receipt;
      };
      active.phase = "launch";
      const receipt = await send(tx.to, tx.calldata, BigInt(tx.valueWei), BigInt(tx.gasLimit));
      check(await client.readContract({ address: stamp, abi: stampAbi, functionName: "launchIdByToken", args: [graph.token] }) === authorized.launchId, "canonical stamp missing");
      const result = await client.readContract({ address: graph.engine, abi: foundationFactoryV2Abi, functionName: "launchOf", args: [graph.token] });
      check(result.hook.toLowerCase() === graph.hook.toLowerCase() && result.basePositionId > 0n
        && result.creatorQuotePrincipal === 0n && result.initialBuyTokenAmount === 0n, "zero-funded launch result mismatch");
      const attached = await client.readContract({ address: graph.hook, abi: hostAbi, functionName: "moduleAt", args: [0n] });
      check(await client.readContract({ address: graph.hook, abi: hostAbi, functionName: "moduleCount" }) === 1n
        && attached.codeHash === selection.moduleCodeHash && attached.configurationHash === keccak256(selection.configuration), "module attachment mismatch");
      check(keccak256((await client.getCode({ address: attached.instance }))!) === selection.moduleCodeHash, "module runtime mismatch");
      Object.assign(active, { phase: "trade", token: graph.token, hook: graph.hook, engine: graph.engine, module: attached.instance,
        factory: selection.factory, blockNumber: authorized.simulation.blockNumber, blockHash: authorized.simulation.blockHash,
        launchId: authorized.launchId, permitDigest: authorized.permitDigest, launchGasUsed: receipt.gasUsed, launchValueWei: "0" });
      // Prove a copied permit cannot launch twice. eth_call modifies only the disposable fork's call context.
      let replayRejected = false;
      try { await local("eth_call", [{ from: account, to: tx.to, data: tx.calldata, value: "0x0" }, "latest"]); }
      catch { replayRejected = true; }
      check(replayRejected, "launch permit was reusable");
      active.replayRejected = true;
      // Linked rules have their own reference-market lifecycle. This probe verifies their real launch admission.
      if (kind < 9) {
        await send(weth, encodeFunctionData({ abi: tokenAbi, functionName: "deposit" }), 10n ** 18n);
        const approve = async (token: Address) => {
          await send(token, encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [permit2, (1n << 256n) - 1n] }));
          await send(permit2, encodeFunctionData({ abi: parseAbi(["function approve(address,address,uint160,uint48)"]), functionName: "approve",
            args: [token, router, (1n << 160n) - 1n, Number((await client.getBlock()).timestamp + 86400n)] }));
        };
        await approve(weth);
        const swap = async (input: Address, outputToken: Address, amount: bigint) => {
          const actions = [
            encodeAbiParameters(parseAbiParameters("((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)"),
              [{ poolKey: graph.poolKey, zeroForOne: input.toLowerCase() === graph.poolKey.currency0.toLowerCase(), amountIn: amount, amountOutMinimum: 1n, minHopPriceX36: 0n, hookData: "0x" }]),
            encodeAbiParameters(parseAbiParameters("address,uint256,bool"), [input, amount, true]),
            encodeAbiParameters(parseAbiParameters("address,address,uint256"), [outputToken, account, 0n]),
          ];
          return send(router, encodeFunctionData({ abi: parseAbi(["function execute(bytes,bytes[],uint256) payable"]), functionName: "execute",
            args: ["0x10", [encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), ["0x060b0e", actions])], (await client.getBlock()).timestamp + 60n] }));
        };
        await swap(weth, graph.token, 10n ** 15n);
        const balance = await client.readContract({ address: graph.token, abi: tokenAbi, functionName: "balanceOf", args: [account] });
        check(balance > 0n, "buy did not deliver tokens");
        active.buyVerified = true;
        await local("evm_increaseTime", [301]); await local("evm_mine");
        if (kind === 0 || kind === 2 || kind === 3) {
          const supplyBefore = await client.readContract({ address: graph.token, abi: tokenAbi, functionName: "totalSupply" });
          await send(graph.hook, encodeFunctionData({ abi: hostAbi, functionName: "executeModuleAction", args: [0n, "0x61461954"] }));
          check(await client.readContract({ address: attached.instance, abi: moduleAbi, functionName: "totalQuoteUsed" }) > 0n, "fee action consumed no budget");
          if (kind === 0) check(await client.readContract({ address: graph.token, abi: tokenAbi, functionName: "totalSupply" }) < supplyBefore, "buyback failed to burn");
          active.feeActionVerified = true;
        }
        await approve(graph.token);
        const quoteBefore = await client.readContract({ address: weth, abi: tokenAbi, functionName: "balanceOf", args: [account] });
        await swap(graph.token, weth, balance);
        check(await client.readContract({ address: graph.token, abi: tokenAbi, functionName: "balanceOf", args: [account] }) === 0n
          && await client.readContract({ address: weth, abi: tokenAbi, functionName: "balanceOf", args: [account] }) > quoteBefore, "sell did not settle");
        active.sellVerified = true;
      } else active.linkedMarketLifecycle = "Covered separately by the published-factory fork suite; this probe checks authorization and launch only";
      Object.assign(active, { status: "passed", phase: "complete" });
      await write(join(output, "result.json"), report);
      console.log(`Passed ${family}`);
    }
    report.success = true;
  } catch (error) {
    if (active && active.status !== "deferred") active.status = "failed";
    report.failureType = error instanceof Error ? error.name : "unknown";
    report.success = false;
    throw error;
  } finally {
    report.completedAt = new Date().toISOString();
    report.passed = cases.filter(c => c.status === "passed").length;
    report.failed = cases.filter(c => c.status === "failed").length;
    report.deferred = cases.filter(c => c.status === "deferred").length;
    report.completeFamilyCoverage = cases.length === families.length && cases.every(c => c.status === "passed");
    report.upstream = { primary: primary.statistics(), secondary: secondary.statistics() };
    await write(join(output, "result.json"), report);
    child.kill("SIGTERM");
    await upstream.close();
  }
}
