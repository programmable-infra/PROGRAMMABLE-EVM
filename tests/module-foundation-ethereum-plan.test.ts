import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, keccak256, stringToHex, type Hex } from "viem";
import fixture from "./fixtures/module-foundation-ethereum-graph.json";
import { foundationEthereumRouteParameters, foundationEthereumStampAbi } from "@/lib/module-foundation/ethereum-graph";
import {
  encodeFoundationEthereumStamp, foundationEthereumGraphCommitment,
  predictFoundationEthereumTarget, prepareFoundationEthereumStamp,
} from "@/lib/module-foundation/ethereum-graph-plan";

function input() {
  const [permit, stamp, payload, signature] = decodeFunctionData({ abi: foundationEthereumStampAbi, data: fixture.calldata as Hex }).args;
  const [route] = decodeAbiParameters(foundationEthereumRouteParameters, payload);
  return { identity: { routeNamespace: route.routeNamespace, routeNonce: route.routeNonce, topologyHash: route.topologyHash },
    targets: route.targets, outputs: route.expectedOutputs, launchId: stamp.launchId, account: permit.launchWallet,
    poolKey: stamp.poolKey, validAfter: permit.validAfter, deadline: permit.deadline, permit, stamp, payload, signature, route };
}

describe("Ethereum Module Mode launch plan", () => {
  it("reproduces every byte of the call executed by the existing canonical Router on the fork", () => {
    const sample = input();
    const plan = prepareFoundationEthereumStamp(sample);
    expect(plan.permit).toEqual(sample.permit);
    expect(plan.stamp).toEqual(sample.stamp);
    expect(plan.route).toEqual(sample.route);
    expect(encodeFoundationEthereumStamp(plan, sample.signature).data).toBe(fixture.calldata);
  });

  it("predicts all three canonical CREATE2 addresses without additional RPC requests", () => {
    const sample = input();
    for (const [index, target] of sample.targets.entries()) {
      expect(predictFoundationEthereumTarget(sample.identity, target).toLowerCase()).toBe(sample.outputs[index].account.toLowerCase());
    }
    expect(foundationEthereumGraphCommitment(sample.identity, sample.targets)).toEqual({
      graphCommitment: sample.route.graphCommitment, totalValue: sample.permit.value,
    });
  });

  it("rejects borrowed output addresses and runtime hashes that are absent", () => {
    const sample = input();
    expect(() => prepareFoundationEthereumStamp({ ...sample, outputs: sample.outputs.map((o, i) => i === 0 ? { ...o, account: sample.outputs[1].account } : o) })).toThrow();
    expect(() => prepareFoundationEthereumStamp({ ...sample, outputs: sample.outputs.map((o, i) => i === 1 ? { ...o, runtimeCodeHash: `0x${"00".repeat(32)}` as Hex } : o) })).toThrow();
  });

  it("binds the deployment result to exact initializer bytes and runtime hashes", () => {
    const sample = input(), original = prepareFoundationEthereumStamp(sample);
    const changedRuntime = prepareFoundationEthereumStamp({ ...sample, outputs: sample.outputs.map((o, i) => i === 0 ? {
      ...o, runtimeCodeHash: keccak256(stringToHex("different runtime")),
    } : o) });
    expect(changedRuntime.permit.expectedResultHash).not.toBe(original.permit.expectedResultHash);
    expect(changedRuntime.permit.stampRequestHash).not.toBe(original.permit.stampRequestHash);
    const changedInitializer = prepareFoundationEthereumStamp({ ...sample, targets: sample.targets.map((target, i) => i === 0
      ? { ...target, initializerCalldata: `${target.initializerCalldata}00` as Hex } : target) });
    expect(changedInitializer.permit.routePayloadHash).not.toBe(original.permit.routePayloadHash);
    expect(changedInitializer.permit.expectedResultHash).not.toBe(original.permit.expectedResultHash);
  });

  it("requires this module topology and sends ETH only to the launch initializer", () => {
    const sample = input();
    expect(() => prepareFoundationEthereumStamp({ ...sample, targets: [...sample.targets].reverse() })).toThrow();
    expect(() => prepareFoundationEthereumStamp({ ...sample, targets: sample.targets.map((target, i) => i === 1 ? {
      ...target, initializerValue: 1n,
    } : target) })).toThrow();
    expect(() => prepareFoundationEthereumStamp({ ...sample, poolKey: { ...sample.poolKey, hooks: sample.outputs[0].account } })).toThrow();
    expect(() => prepareFoundationEthereumStamp({ ...sample, deadline: sample.validAfter })).toThrow();
  });

  it("keeps a newly prepared graph separate from a signed permit", () => {
    expect(() => encodeFoundationEthereumStamp(prepareFoundationEthereumStamp(input()), "0x")).toThrow("authority");
  });
});
