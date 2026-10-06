import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionResult, type PublicClient } from "viem";
import { foundationFactoryV3Abi } from "@/lib/module-foundation/abi";
import { prepareFoundationEthereumLaunch } from "@/lib/module-foundation/ethereum-preparation";
import { foundationV2Fixture, v2Address } from "./module-foundation-v2-fixture";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), graph: vi.fn() }));
vi.mock("@/lib/module-foundation/ethereum-authorization", () => ({ requestEthereumModuleAuthorization: mocks.authorize }));
vi.mock("@/lib/module-foundation/ethereum-graph-builder", () => ({
  buildFoundationEthereumGraph: mocks.graph, assertFoundationEthereumTransaction: vi.fn(),
}));

describe("Ethereum launch funding before authorization", () => {
  beforeEach(() => vi.resetAllMocks());
  it("reports missing ETH before requesting a permit instead of surfacing an authorization error", async () => {
    const f = foundationV2Fixture();
    const hash = `0x${"11".repeat(32)}` as const;
    mocks.graph.mockResolvedValue({ engine: v2Address(4), token: f.result.token, hook: f.result.hook,
      parameters: { ...f.parameters, hookSalt: hash }, targets: [], graphCommitment: hash,
      identity: { routeNamespace: hash, routeNonce: hash, topologyHash: hash } });
    const getBalance = vi.fn(async () => 1n), getGasPrice = vi.fn(async () => 1_000_000_000n);
    const client = { getBalance, getGasPrice, simulateCalls: vi.fn(async () => ({ results: [
      { status: "success", data: "0x", gasUsed: 6_000_000n },
      { status: "success", data: encodeFunctionResult({ abi: foundationFactoryV3Abi, functionName: "launchOf", result: f.result }), gasUsed: 1n },
    ] })) } as unknown as PublicClient;
    const input = { client, binding: { ...f.binding, ethereumGraph: { implementation: f.binding.factory } },
      account: v2Address(3), parameters: { ...f.parameters, creatorBuyFeeBps: 0, creatorSellFeeBps: 0 },
      slippageBps: 100, checkpoint: f.checkpoint, quote: f.quote, price: f.price,
      modulePackageIds: [], moduleAssetPins: [], accessToken: async () => "fixture-access" };
    // Later price and source fields are deliberately absent: an unfunded request must stop before using them.
    await expect(prepareFoundationEthereumLaunch(input as unknown as Parameters<typeof prepareFoundationEthereumLaunch>[0]))
      .rejects.toThrow("Keep enough ETH");
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(getBalance).toHaveBeenCalledOnce();
    expect(getGasPrice).toHaveBeenCalledOnce();
  });
});
