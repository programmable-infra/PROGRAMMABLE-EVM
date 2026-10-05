import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";

const root = new URL("../../", import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
const deployment = await readJson("contracts/deployments/ethereum-module-foundation-v1.json");
const contracts = {};
for (const name of ["FoundationEthereumGraphProxyV1", "FoundationTokenV1", "FoundationHookV2"]) {
  const artifact = await readJson(`contracts/out/module-foundation/${name}.sol/${name}.json`);
  const { settings, sources, compiler } = artifact.metadata;
  if (compiler.version !== "0.8.26+commit.8a97fa7a" || settings.evmVersion !== "cancun"
    || !settings.viaIR || !settings.optimizer.enabled || settings.optimizer.runs !== 200
    || settings.metadata.bytecodeHash !== "none" || settings.metadata.appendCBOR !== false
    || Object.keys(settings.libraries).length) throw new Error(`Unexpected compiler settings: ${name}`);
  for (const [path, source] of Object.entries(sources)) {
    const bytes = await readFile(new URL(`contracts/${path}`, root));
    if (keccak256(bytes) !== source.keccak256) throw new Error(`Stale compiler input: ${path}`);
  }
  const creationBytecode = artifact.bytecode.object;
  const runtimeTemplate = artifact.deployedBytecode.object;
  if (![creationBytecode, runtimeTemplate].every(code => /^0x(?:[a-f0-9]{2})+$/i.test(code))) {
    throw new Error(`Unlinked bytecode: ${name}`);
  }
  contracts[name] = {
    constructorInputs: artifact.abi.find(item => item.type === "constructor").inputs,
    creationBytecode, creationCodeHash: keccak256(creationBytecode), runtimeTemplate,
    immutableReferences: Object.values(artifact.deployedBytecode.immutableReferences).flat(),
    sources: Object.fromEntries(Object.entries(sources).map(([path, source]) => [path, source.keccak256])),
  };
}
const body = JSON.stringify({
  schemaVersion: "programmable.ethereum-module-bytecode.v1", sourceCommit: deployment.sourceCommit,
  compilerVersion: "0.8.26+commit.8a97fa7a", evmVersion: "cancun", viaIR: true,
  optimizerRuns: 200, contracts,
}, null, 2) + "\n";
const output = new URL("contracts/spec/module-foundation/ethereum-graph-bytecode.v1.json", root);
if (process.argv.includes("--check")) {
  if (await readFile(output, "utf8") !== body) throw new Error("Ethereum bytecode export is stale");
} else await writeFile(output, body);
console.log(`${process.argv.includes("--check") ? "Verified" : "Exported"} three source-bound Ethereum graph contracts (${Buffer.byteLength(body)} bytes): ${fileURLToPath(output)}`);
