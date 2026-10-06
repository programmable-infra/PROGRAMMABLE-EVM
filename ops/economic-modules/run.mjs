import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, getAddress, isHash, keccak256, parseAbi, parseAbiItem, stringToHex, toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runEconomicPass } from "./engine.mjs";
import { economicHttp } from "./rpc.mjs";

const families = new Map([
  ...["buyback-burn", "dip-buyback", "lp-rewards", "full-range-lp"].map(id => [id, "strategy"]),
  ...["buyer-rewards", "nth-buy-pot", "king-of-the-hill"].map(id => [id, "rewards"]),
]);
const hostAbi = parseAbi([
  "struct Descriptor { bytes32 moduleId; uint16 abiVersion; uint8 phases; uint8 resources; uint32 beforeGas; uint32 afterGas; uint32 actionGas; bool failOpenAfter; bytes32 exclusiveGroup; }",
  "struct Module { address instance; bytes32 codeHash; bytes32 configurationHash; Descriptor descriptor; }",
  "function moduleAt(uint256 index) view returns (Module)",
  "function executeModuleAction(uint256 index, bytes data)",
]);
const moduleAbi = parseAbi(["function executableBudget() view returns (uint256)", "function owed(address) view returns (uint256)"]);
const rewardEvent = parseAbiItem("event RewardAccrued(address indexed beneficiary, uint256 amount)");

export function validateExecutionConfig(config) {
  if (!config || ![1, 4663].includes(config.chainId) || !Array.isArray(config.targets) || config.targets.length > 1000
    || !Number.isSafeInteger(config.confirmations) || config.confirmations < (config.chainId === 1 ? 12 : 64)
    || !/^[A-Z][A-Z0-9_]+$/.test(config.rpcEnv ?? "") || !/^[A-Z][A-Z0-9_]+$/.test(config.keyEnv ?? "")
    || !/^[1-9][0-9]*$/.test(config.maxFeePerGasWei ?? "")
    || !/^[1-9][0-9]*$/.test(config.maxGasSpendPerDayWei ?? "")) throw new Error("Invalid execution configuration");
  const targets = config.targets.map(target => {
    if (!families.has(target.family) || !Number.isInteger(target.index) || target.index < 0 || target.index > 7
      || !isHash(target.runtimeHash) || !isHash(target.configurationHash)
      || !/^[0-9]+$/.test(target.deployedBlock ?? "")
      || (target.deploymentBlockHash !== undefined && !isHash(target.deploymentBlockHash))) throw new Error("Invalid admitted target");
    const host = getAddress(target.host), instance = getAddress(target.module);
    return { ...target, host, module: instance, id: `${host}:${target.index}`, kind: families.get(target.family) };
  });
  if (new Set(targets.map(t => t.id)).size !== targets.length) throw new Error("Duplicate execution target");
  return { ...config, targets };
}

export function createExecutionAdapter({ config, client, wallet, account }) {
  let head;
  const maxFee = BigInt(config.maxFeePerGasWei);
  return {
    async receipt(hash) {
      head ??= await client.getBlockNumber();
      let receipt;
      try { receipt = await client.getTransactionReceipt({ hash }); }
      catch (error) { if (error.name === "TransactionReceiptNotFoundError") return null; throw error; }
      if (head < receipt.blockNumber + BigInt(config.confirmations)) return null;
      return { success: receipt.status === "success" };
    },
    async submit(raw) { return client.sendRawTransaction({ serializedTransaction: raw }); },
    async prepare(target, entry) {
      head ??= await client.getBlockNumber();
      const blockNumber = head - BigInt(config.confirmations);
      if (blockNumber < BigInt(target.deployedBlock)) return null;
      if (target.deploymentBlockHash && (await client.getBlock({ blockNumber: BigInt(target.deployedBlock) })).hash !== target.deploymentBlockHash) {
        throw new Error("The registered launch was reorganized");
      }
      const bound = await client.readContract({ address: target.host, abi: hostAbi, functionName: "moduleAt", args: [BigInt(target.index)], blockNumber });
      const code = await client.getCode({ address: target.module, blockNumber });
      if (getAddress(bound.instance) !== target.module || bound.codeHash !== target.runtimeHash
        || bound.configurationHash !== target.configurationHash || !code || keccak256(code) !== target.runtimeHash
        || bound.descriptor.moduleId !== keccak256(stringToHex(`programmable.foundation.${target.family}.v1`))) {
        throw new Error("Target differs from its admitted runtime and host binding");
      }
      let action;
      if (target.kind === "strategy") {
        const budget = await client.readContract({ address: target.module, abi: moduleAbi, functionName: "executableBudget" });
        if (!budget) return null;
        action = toFunctionSelector("execute()");
      } else {
        // Scan confirmed events in bounded windows, not every block since genesis on each pass.
        // A changed cursor hash replays from deployment. Owed balances make replay idempotent.
        if (entry.scannedBlock !== undefined && entry.scannedHash) {
          const previous = await client.getBlock({ blockNumber: BigInt(entry.scannedBlock) });
          if (previous.hash !== entry.scannedHash) { delete entry.scannedBlock; delete entry.scannedHash; }
        }
        const fromBlock = entry.scannedBlock === undefined ? BigInt(target.deployedBlock) : BigInt(entry.scannedBlock) + 1n;
        if (fromBlock <= blockNumber && (entry.beneficiaries?.length ?? 0) < 5000) {
          let toBlock = fromBlock + 999n < blockNumber ? fromBlock + 999n : blockNumber;
          let logs = await client.getLogs({ address: target.module, event: rewardEvent, fromBlock, toBlock, strict: true });
          const queued = () => [...new Set([...(entry.beneficiaries ?? []), ...logs.map(log => getAddress(log.args.beneficiary))])];
          if (queued().length > 10000) {
            toBlock = fromBlock;
            logs = await client.getLogs({ address: target.module, event: rewardEvent, fromBlock, toBlock, strict: true });
          }
          const beneficiaries = queued();
          if (beneficiaries.length > 10000) throw new Error("One block exceeds the bounded payment queue");
          const block = await client.getBlock({ blockNumber: toBlock });
          entry.beneficiaries = beneficiaries;
          entry.scannedBlock = toBlock.toString(); entry.scannedHash = block.hash;
        }
        const beneficiaries = entry.beneficiaries ?? [];
        const active = [];
        const checked = beneficiaries.slice(0, entry.singlePayments ? 1 : 16);
        for (const beneficiary of checked) {
          const owed = await client.readContract({ address: target.module, abi: moduleAbi, functionName: "owed", args: [beneficiary] });
          if (owed > 0n) active.push(beneficiary);
        }
        // Rotate the queue so a temporarily unpayable beneficiary cannot starve every later one.
        entry.beneficiaries = [...beneficiaries.slice(checked.length), ...active];
        if (!active.length) return null;
        action = `${toFunctionSelector("pay(address[])" )}${encodeAbiParameters([{ type: "address[]" }], [active]).slice(2)}`;
      }
      const transaction = { account, to: target.host, data: encodeFunctionData({ abi: hostAbi, functionName: "executeModuleAction", args: [BigInt(target.index), action] }) };
      // Latest-state simulation also verifies price history, slippage, dip threshold and other guards.
      try { await client.call({ ...transaction, gas: 3000000n }); }
      catch (error) {
        // Some quote tokens reject a particular recipient. On the next pass pay one at a
        // time, rotating after every attempt, so that recipient cannot block the other debts.
        if (target.kind === "rewards") entry.singlePayments = true;
        throw error;
      }
      return transaction;
    },
    async sign(transaction) {
      const request = await wallet.prepareTransactionRequest({ ...transaction, gas: 3000000n });
      const fee = request.maxFeePerGas ?? request.gasPrice;
      if (fee === undefined || fee > maxFee) throw new Error("Gas price exceeds the configured ceiling");
      const raw = await account.signTransaction(request);
      return { raw, hash: keccak256(raw), maxGasCostWei: (fee * request.gas).toString() };
    },
  };
}

async function main() {
  const [configPath, journalPath, flag] = process.argv.slice(2);
  if (!configPath || !journalPath || (flag && !["--broadcast", "--preview-state"].includes(flag))) throw new Error("Usage: run.mjs CONFIG JOURNAL [--broadcast|--preview-state]");
  const config = validateExecutionConfig(JSON.parse(await readFile(configPath, "utf8")));
  const rpc = process.env[config.rpcEnv];
  if (!rpc) throw new Error("Configured RPC environment variable is missing");
  const broadcast = flag === "--broadcast";
  const account = broadcast ? privateKeyToAccount(process.env[config.keyEnv] ?? "") : getAddress(config.simulationAccount);
  const chain = { id: config.chainId, name: `Execution ${config.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
  const transport = economicHttp(rpc);
  const client = createPublicClient({ chain, transport });
  if (await client.getChainId() !== config.chainId) throw new Error("RPC chain mismatch");
  const wallet = createWalletClient({ chain, transport, account });
  const journal = resolve(journalPath), lock = `${journal}.lock`;
  await mkdir(lock); // Exclusive local single-writer lock. A stale lock needs operator review.
  try {
    let state;
    try { state = JSON.parse(await readFile(journal, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; state = { chainId: config.chainId, account: typeof account === "string" ? account : account.address, ...(flag === "--preview-state" ? { mode: "preview" } : {}) }; }
    if ((flag === "--preview-state" && (state.mode !== "preview" || state.pending))
      || (broadcast && state.mode === "preview")) throw new Error("Preview and live journals must remain separate");
    if (state.chainId !== config.chainId || getAddress(state.account) !== getAddress(typeof account === "string" ? account : account.address)) throw new Error("Journal account or chain mismatch");
    const persist = async value => {
      if (!broadcast && flag !== "--preview-state") return; // Plain dry runs remain read-only; the service owns a separate preview journal.
      const tmp = `${journal}.${process.pid}.tmp`;
      const file = await open(tmp, "w", 0o600);
      try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); }
      finally { await file.close(); }
      await rename(tmp, journal);
      const directory = await open(dirname(journal), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    };
    const report = await runEconomicPass({ targets: config.targets, state, adapter: createExecutionAdapter({ config, client, wallet, account }), persist,
      now: Math.floor(Date.now() / 1000), broadcast, maxGasSpendPerDayWei: BigInt(config.maxGasSpendPerDayWei) });
    console.log(JSON.stringify({ chainId: config.chainId, broadcast, ...report }));
  } finally { await rm(lock, { recursive: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Execution pass failed. The durable journal retains pending work; inspect the configured service before retrying."); process.exitCode = 1; });
}
