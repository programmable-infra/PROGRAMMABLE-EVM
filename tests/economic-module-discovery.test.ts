import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, stringToHex, type PublicClient } from "viem";
import { discoverEconomicTargets, type AutomaticModuleAdmission } from "@/ops/economic-modules/discovery";
import { discoverFoundationLaunch } from "@/lib/module-foundation/discovery";
import { hashFoundationModuleDescriptorV1 } from "@/lib/module-foundation/manifest";
import { ETHEREUM_MODULE_BINDING } from "@/lib/module-foundation/ethereum-release";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import type { FoundationDeploymentBinding } from "@/lib/module-foundation/protocol";
import { FOUNDATION_LP_CUSTODY_DEAD_ID } from "@/lib/module-foundation/constants";
vi.mock("@/lib/module-foundation/discovery", () => ({ discoverFoundationLaunch: vi.fn(), FOUNDATION_DISCOVERY_MAX_BLOCKS: 5000n }));
vi.mock("@/contracts/spec/module-foundation/chain-1.v1.json", async importOriginal => {
  const original = await importOriginal<{ default: typeof ethereum }>();
  const { keccak256 } = await import("viem");
  return { default: { ...original.default, canonicalStamp: { ...original.default.canonicalStamp,
    router: { ...original.default.canonicalStamp.router, runtimeCodeHash: keccak256("0x6000") } } } };
});

const factory = "0x1111111111111111111111111111111111111111", host = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333", instance = "0x4444444444444444444444444444444444444444";
const code = "0x6000", hash = keccak256(code), configuration = "0x1234", blockHash = keccak256("0x4321");
const descriptor = { moduleId: keccak256(stringToHex("programmable.foundation.buyer-rewards.v1")), abiVersion: 1,
  phases: 6, resources: 1, beforeGas: 0, afterGas: 240000, actionGas: 150000, failOpenAfter: false, exclusiveGroup: hash };
const admission: AutomaticModuleAdmission = { family: "buyer-rewards", factory, factoryCodeHash: hash, moduleCodeHash: hash, descriptorHash: hashFoundationModuleDescriptorV1(descriptor) };

function setup(chainId: 1 | 4663 = 4663) {
  const start = chainId === 1 ? ETHEREUM_MODULE_BINDING.startBlock : 100n;
  const binding: FoundationDeploymentBinding = chainId === 1 ? ETHEREUM_MODULE_BINDING : {
    chainId, factoryVersion: "v3", lpCustodyId: FOUNDATION_LP_CUSTODY_DEAD_ID, sourceCommit: "a".repeat(40), releaseDigest: hash, startBlock: start,
    factory: { address: factory, runtimeCodeHash: hash }, hookDeployer: { address: host, runtimeCodeHash: hash } };
  const event = { address: chainId === 1 ? ethereum.canonicalStamp.router.address : factory,
    args: { token, launchId: hash }, transactionHash: hash, blockNumber: start, blockHash, logIndex: 1, removed: false };
  const bound = { instance, codeHash: hash, configurationHash: keccak256(configuration), descriptor };
  const client = { getChainId: vi.fn(async () => chainId), getCode: vi.fn(async () => code),
    getBlock: vi.fn(async () => ({ hash: blockHash })), getLogs: vi.fn(async () => [event]), readContract: vi.fn(async () => bound),
    getTransactionReceipt: vi.fn(async () => ({ status: "success", blockHash, logs: [] as unknown[] })) };
  vi.mocked(discoverFoundationLaunch).mockReset();
  vi.mocked(discoverFoundationLaunch).mockResolvedValue({ checkpoint: { blockNumber: start, blockHash },
    observedAt: { blockNumber: start + 64n }, receipt: { event: { hook: host } },
    moduleSelections: [{ ...admission, configuration }] } as unknown as Awaited<ReturnType<typeof discoverFoundationLaunch>>);
  const input = { clients: [client, client] as unknown as readonly [PublicClient, PublicClient], binding,
    admissions: [admission], position: { block: start.toString(), logIndex: -1 }, toBlock: start + 100n };
  return { input, client, event, bound, start };
}

describe("automatic economic module registration", () => {
  it.each(["v2", "v3"] as const)("verifies a canonical %s launch on both providers before registering its exact module", async version => {
    const f = setup();
    f.input.binding.factoryVersion = version;
    const result = await discoverEconomicTargets(f.input);
    expect(result.targets).toEqual([{ family: "buyer-rewards", host, module: instance, index: 0, runtimeHash: hash,
      configurationHash: keccak256(configuration), deployedBlock: "100", deploymentBlockHash: blockHash, transactionHash: hash }]);
    expect(discoverFoundationLaunch).toHaveBeenCalledTimes(2);
    expect(result.position).toEqual({ block: "200", logIndex: Number.MAX_SAFE_INTEGER, blockHash });
  });
  it("rejects a forged emitter, wrong chain, reorganized cursor or unbound instance", async () => {
    for (const problem of ["emitter", "chain", "cursor", "instance"] as const) {
      const f = setup();
      if (problem === "emitter") f.event.address = instance;
      if (problem === "chain") f.client.getChainId.mockResolvedValue(1);
      if (problem === "instance") f.bound.configurationHash = hash;
      const position = problem === "cursor" ? { ...f.input.position, blockHash: hash } : f.input.position;
      await expect(discoverEconomicTargets({ ...f.input, position })).rejects.toThrow();
    }
  });
  it("does not enroll an arbitrary same-name module or a provider-disputed event", async () => {
    const f = setup();
    expect((await discoverEconomicTargets({ ...f.input, admissions: [{ ...admission, factory: instance }] })).targets).toEqual([]);
    const other = { ...f.client, getLogs: async () => [] } as unknown as PublicClient;
    await expect(discoverEconomicTargets({ ...f.input, clients: [f.input.clients[0], other] })).rejects.toThrow("disagree");
  });
  it("advances at most eight launches and resumes within the same block without skipping", async () => {
    const f = setup();
    f.client.getLogs.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({ ...f.event, logIndex: index })));
    const first = await discoverEconomicTargets(f.input);
    expect(first.processed).toBe(8);
    expect(first.position.logIndex).toBe(7);
    const second = await discoverEconomicTargets({ ...f.input, position: first.position });
    expect(second.processed).toBe(2);
    expect(second.position.block).toBe("200");
  });
  it("can checkpoint each verified launch within one block", async () => {
    const f = setup();
    f.client.getLogs.mockResolvedValue([{ ...f.event, logIndex: 1 }, { ...f.event, logIndex: 2 }]);
    const first = await discoverEconomicTargets({ ...f.input, maxLaunches: 1 });
    expect(first.processed).toBe(1);
    expect(first.position).toEqual({ block: "100", logIndex: 1, blockHash });
    const second = await discoverEconomicTargets({ ...f.input, maxLaunches: 1, position: first.position });
    expect(second.processed).toBe(1);
    expect(second.position.block).toBe("200");
  });
  it("covers sparse history in bounded 5,000-block windows with the same provider agreement", async () => {
    const f = setup();
    f.client.getLogs.mockResolvedValue([]);
    const input = { ...f.input, toBlock: f.start + 4999n };
    expect((await discoverEconomicTargets(input)).position.block).toBe("5099");
    expect(f.client.getLogs).toHaveBeenCalledTimes(2);
    await expect(discoverEconomicTargets({ ...input, toBlock: f.start + 5000n })).rejects.toThrow("Invalid discovery window");
    const disputed = { ...f.client, getLogs: async () => [f.event] } as unknown as PublicClient;
    await expect(discoverEconomicTargets({ ...input, clients: [f.input.clients[0], disputed] })).rejects.toThrow("disagree");
  });
  it("requires a canonical Ethereum component stamp before using the per-launch engine", async () => {
    const f = setup(1);
    expect((await discoverEconomicTargets(f.input)).targets).toEqual([]);
    expect(discoverFoundationLaunch).not.toHaveBeenCalled();
    const abi = parseAbi(["event ProgrammableComponentStampedV1(bytes32 indexed launchId,address indexed component,uint8 indexed kind,bytes32 runtimeCodeHash)"]);
    f.client.getTransactionReceipt.mockResolvedValue({ status: "success", blockHash, logs: [{
      address: ethereum.canonicalStamp.router.address,
      topics: encodeEventTopics({ abi, eventName: "ProgrammableComponentStampedV1", args: { launchId: hash, component: factory, kind: 0 } }),
      data: encodeAbiParameters([{ type: "bytes32" }], [ETHEREUM_MODULE_BINDING.ethereumGraph!.proxyRuntimeCodeHash]),
    }] });
    expect((await discoverEconomicTargets(f.input)).targets).toHaveLength(1);
    expect(discoverFoundationLaunch).toHaveBeenCalledWith(expect.objectContaining({ binding: expect.objectContaining({
      factory: { address: factory, runtimeCodeHash: ETHEREUM_MODULE_BINDING.ethereumGraph!.proxyRuntimeCodeHash },
    }) }));
  });
});
