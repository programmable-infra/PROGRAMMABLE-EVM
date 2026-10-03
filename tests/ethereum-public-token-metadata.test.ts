import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import { canonicalTokenExploreEntryV1 } from "@/lib/explore-entry-v1";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/onchain/website-rpc-providers.server", () => ({ productionMainnetRpcPrimary: () => ({ url: "https://rpc.example.com" }) }));
import { createEthereumPublicMetadataReader, ETHEREUM_METADATA_BATCH_SIZE, ETHEREUM_METADATA_RECOVERY_MS, ETHEREUM_METADATA_TTL_MS,
  parseEthereumMetadataReads, parseEthereumTokenUri } from "@/lib/server/ethereum-public-token-metadata";

const boundary = { asOfBlock: "26113816", asOfBlockHash: `0x${"ab".repeat(32)}` };
const json = { name: "JSON spoof", symbol: "SPOOF", description: "A public token", image: "https://picsum.photos/id/960/512/512.jpg",
  external_url: "https://programmable.market/", twitter: "https://x.com/ProgrammableHQ" };
const uri = (value = json) => `data:application/json;utf8,${JSON.stringify(value)}`;
const success = (result: unknown) => ({ status: "success" as const, result });
const failure = { status: "failure" as const };
const reads = (name = "123", symbol = "123", tokenUri = uri()) => [success(name), success(symbol), failure, success(tokenUri)];
afterEach(() => vi.unstubAllGlobals());

function rpcFixture(hash = boundary.asOfBlockHash, oversized = false) {
  const aggregate = parseAbi(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"]);
  const getters = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function tokenURI() view returns (string)"]);
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(init?.body as string);
    let result: unknown;
    if (request.method === "eth_getBlockByNumber") result = { hash, number: `0x${BigInt(boundary.asOfBlock).toString(16)}`, transactions: [] };
    else {
      expect(request.method).toBe("eth_call");
      const calls = decodeFunctionData({ abi: aggregate, data: request.params[0].data }).args[0];
      expect(calls).toHaveLength(4);
      expect(calls.every(call => call.target.toLowerCase() === customGraphExploreEntry.tokenAddress.toLowerCase())).toBe(true);
      expect(request.params[1]).toBe(`0x${BigInt(boundary.asOfBlock).toString(16)}`);
      result = encodeFunctionResult({ abi: aggregate, functionName: "aggregate3", result: [
        { success: true, returnData: encodeFunctionResult({ abi: getters, functionName: "name", result: "123" }) },
        { success: true, returnData: encodeFunctionResult({ abi: getters, functionName: "symbol", result: "123" }) },
        { success: false, returnData: "0x" },
        { success: true, returnData: encodeFunctionResult({ abi: getters, functionName: "tokenURI", result: uri() }) },
      ] });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      headers: { "Content-Type": "application/json", ...(oversized ? { "Content-Length": "2000000" } : {}) },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("public Ethereum token metadata", () => {
  it("uses one multicall and one exact-block read for all token fields, with no provider retry", async () => {
    const fetcher = rpcFixture();
    const [display] = await createEthereumPublicMetadataReader()([customGraphExploreEntry], boundary);
    expect(display?.name).toBe("123"); expect(display?.imageUrl).toBe(json.image);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) expect(call[1]).toMatchObject({ cache: "no-store", redirect: "error" });
  });
  it("retains the canonical token on RPC block mismatch or oversized response without exposing provider data", async () => {
    rpcFixture(`0x${"cd".repeat(32)}`);
    expect(await createEthereumPublicMetadataReader()([customGraphExploreEntry], boundary)).toEqual([customGraphExploreEntry]);
    const fetcher = rpcFixture(boundary.asOfBlockHash, true);
    expect(await createEthereumPublicMetadataReader()([customGraphExploreEntry], boundary)).toEqual([customGraphExploreEntry]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("imports inline ERC-1046 image, description, website and X without trusting JSON names", () => {
    expect(parseEthereumMetadataReads(reads())).toEqual({ name: "123", symbol: "123", description: "A public token",
      imageUrl: json.image, links: [{ kind: "website", url: json.external_url }, { kind: "x", url: json.twitter }] });
  });
  it("accepts literal UTF-8, percent-encoded JSON and strict base64", () => {
    const expected = parseEthereumTokenUri(uri());
    expect(parseEthereumTokenUri(`data:application/json,${encodeURIComponent(JSON.stringify(json))}`)).toEqual(expected);
    expect(parseEthereumTokenUri(`data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(json)).toString("base64")}`)).toEqual(expected);
    expect(parseEthereumTokenUri(uri({ ...json, image: `${json.image}?x=100%25` }))?.imageUrl).toContain("100%25");
  });
  it("prefers a supported metadata getter and preserves explicit clearing of old fields", () => {
    expect(parseEthereumMetadataReads([success("Renamed"), success("NEW"), success(["", "", "", "0x"]), success(uri())]))
      .toEqual({ name: "Renamed", symbol: "NEW", description: null, imageUrl: null, links: [] });
    expect(parseEthereumMetadataReads([success("A coin"), success("ABC"), success(["Description", json.external_url, json.image,
      `0x${Buffer.from(JSON.stringify({ v: 1, x: json.twitter })).toString("hex")}`]), failure])?.links)
      .toEqual([{ kind: "website", url: json.external_url }, { kind: "x", url: json.twitter }]);
  });
  it("rejects executable/external URIs, malformed, duplicate, deep, oversized or invalid UTF-8 JSON", () => {
    for (const candidate of ["https://example.com/token.json", "http://localhost/metadata", "javascript:alert(1)",
      "data:text/html,<script>x</script>", "data:application/json;utf8,[]", "data:application/json;utf8,{\"image\":\"a\",\"image\":\"b\"}",
      `data:application/json;utf8,${'{"x":'.repeat(10)}0${"}".repeat(10)}`,
      `data:application/json;utf8,{"description":"${"x".repeat(17_000)}"}`,
      "data:application/json;base64,YQ!", "data:application/json;base64,/w==", "data:application/json,%ZZ"]) {
      expect(parseEthereumTokenUri(candidate), candidate.slice(0, 80)).toBeNull();
    }
  });
  it("rejects unsafe URLs and display characters without dropping safe independent fields", () => {
    const value = parseEthereumMetadataReads(reads("Bad\u0000name", "bad symbol", uri({ ...json,
      description: "Bad\u0000text", image: "https://user:password@example.com/x.png", external_url: "http://localhost/",
      twitter: "https://example.com/fake-x" })));
    expect(value).toEqual({ imageUrl: null, links: [] });
    expect(parseEthereumMetadataReads([failure, failure, failure, failure])).toBeNull();
  });
  it("keeps launch eligibility independent of metadata failure and backs off concurrent reads", async () => {
    let clock = 0;
    const readBatch = vi.fn(async () => { throw new Error("private provider error"); });
    const read = createEthereumPublicMetadataReader({ readBatch, now: () => clock });
    const [a, b] = await Promise.all([read([customGraphExploreEntry], boundary), read([customGraphExploreEntry], boundary)]);
    expect(a).toEqual([customGraphExploreEntry]); expect(b).toEqual(a);
    expect(readBatch).toHaveBeenCalledTimes(1);
    await read([customGraphExploreEntry], boundary); expect(readBatch).toHaveBeenCalledTimes(1);
    clock = 15_001; await read([customGraphExploreEntry], boundary); expect(readBatch).toHaveBeenCalledTimes(2);
  });
  it("coalesces catalog/detail reads, refreshes a later rename and leaves the saved stamp unchanged", async () => {
    let clock = 0;
    const original = structuredClone(customGraphExploreEntry);
    const readBatch = vi.fn().mockResolvedValueOnce(reads()).mockResolvedValueOnce(reads("New name", "NEW"));
    const read = createEthereumPublicMetadataReader({ readBatch, now: () => clock });
    const [first, duplicate] = await Promise.all([read([customGraphExploreEntry], boundary), read([customGraphExploreEntry], boundary)]);
    expect(first).toEqual(duplicate); expect(first[0]?.name).toBe("123");
    expect(readBatch).toHaveBeenCalledTimes(1);
    await read([customGraphExploreEntry], { ...boundary, asOfBlock: "26113817" }); expect(readBatch).toHaveBeenCalledTimes(1);
    clock = ETHEREUM_METADATA_TTL_MS + 1;
    const [updated] = await read([customGraphExploreEntry], { ...boundary, asOfBlock: "26113818" });
    expect(updated?.name).toBe("New name"); expect(updated?.symbol).toBe("NEW");
    expect(updated?.launchStampProvenance).toEqual(original.launchStampProvenance);
    expect(canonicalTokenExploreEntryV1(updated!)).toEqual(updated);
    expect(customGraphExploreEntry).toEqual(original); expect(readBatch).toHaveBeenCalledTimes(2);
  });
  it("keeps recent display metadata through a short provider interruption without extending its maximum age", async () => {
    let clock = 0;
    const readBatch = vi.fn().mockResolvedValueOnce(reads()).mockRejectedValue(new Error("provider unavailable"));
    const read = createEthereumPublicMetadataReader({ readBatch, now: () => clock });
    const first = await read([customGraphExploreEntry], boundary);
    clock = ETHEREUM_METADATA_TTL_MS + 1;
    expect(await read([customGraphExploreEntry], boundary)).toEqual(first);
    expect(await read([customGraphExploreEntry], boundary)).toEqual(first);
    expect(readBatch).toHaveBeenCalledTimes(2);
    clock = ETHEREUM_METADATA_RECOVERY_MS + 1;
    expect(await read([customGraphExploreEntry], boundary)).toEqual([customGraphExploreEntry]);
    expect(readBatch).toHaveBeenCalledTimes(3);
  });
  it("does not reuse metadata from a newer or different canonical block", async () => {
    const readBatch = vi.fn().mockResolvedValueOnce(reads("Recent", "NEW")).mockResolvedValue(reads("Older", "OLD"));
    const read = createEthereumPublicMetadataReader({ readBatch });
    await read([customGraphExploreEntry], boundary);
    const [older] = await read([customGraphExploreEntry], { ...boundary, asOfBlock: "26113815" });
    expect(older?.name).toBe("Older"); expect(readBatch).toHaveBeenCalledTimes(2);
    await read([customGraphExploreEntry], { asOfBlock: "26113815", asOfBlockHash: `0x${"cd".repeat(32)}` });
    expect(readBatch).toHaveBeenCalledTimes(3);
  });
  it("does not read unknown, classic, mismatched, or not-yet-finalized identities", async () => {
    const readBatch = vi.fn().mockResolvedValue(reads());
    const read = createEthereumPublicMetadataReader({ readBatch });
    const unknown = { ...customGraphExploreEntry, launchStampProvenance: undefined };
    const mismatched = { ...customGraphExploreEntry, tokenAddress: "0x3333333333333333333333333333333333333333" as const };
    await read([unknown, mismatched], boundary);
    await read([customGraphExploreEntry], { ...boundary, asOfBlock: "25717952" });
    await read([customGraphExploreEntry], { ...boundary, asOfBlock: "latest" });
    expect(readBatch).not.toHaveBeenCalled();
  });
  it("bounds work to 50 recent identities without removing other canonical launches", async () => {
    const entries = Array.from({ length: ETHEREUM_METADATA_BATCH_SIZE + 2 }, (_, i) => {
      const address = `0x${(i + 1).toString(16).padStart(40, "0")}` as const;
      const original = customGraphExploreEntry.launchStampProvenance!;
      const proof = { ...original, tokenProof: { ...original.tokenProof, tokenAddress: address },
        poolKey: { ...original.poolKey, currency1: address },
        components: original.components.map(component => component.kind === "token" ? { ...component, address } : component) };
      return { ...customGraphExploreEntry, tokenAddress: address, launchStampProvenance: proof };
    });
    const readBatch = vi.fn(async (addresses: readonly string[]) => addresses.flatMap(() => reads()));
    const result = await createEthereumPublicMetadataReader({ readBatch })(entries, boundary);
    expect(readBatch.mock.calls[0]?.[0]).toHaveLength(ETHEREUM_METADATA_BATCH_SIZE);
    expect(result).toHaveLength(entries.length);
    expect(result.filter(entry => entry.name === "123")).toHaveLength(ETHEREUM_METADATA_BATCH_SIZE);
  });
});
