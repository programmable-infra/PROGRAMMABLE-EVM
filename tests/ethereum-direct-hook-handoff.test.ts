import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toFunctionSelector, toEventSelector } from "viem";
const archive = join(process.cwd(), "public/developers/ethereum-custom-hook-indexing.zip");
const read = (name: string) => execFileSync("unzip", ["-p", archive, `ethereum-custom-hook-indexing/${name}`], {
  timeout: 10_000, maxBuffer: 1_048_576, stdio: ["ignore", "pipe", "pipe"],
});
const json = (name: string) => JSON.parse(read(name).toString("utf8"));

describe("Ethereum direct Custom Hook handoff", () => {
  it("ships the exact manifest-bound ABI and intact source files", () => {
    const manifest = json("ethereum-stamp-manifest.snapshot.json");
    expect(manifest.chainId).toBe(1);
    expect(manifest.launchStampRouter.status).toBe("live");
    for (const [name, hash] of Object.entries(json("SHA256SUMS.json"))) {
      expect(createHash("sha256").update(read(name)).digest("hex")).toBe(hash);
    }
    expect(json("SHA256SUMS.json")["programmable-launch-stamp-router-v1.json"])
      .toBe(manifest.launchStampRouter.abiSha256.replace(/^sha256:/, ""));
    expect(toFunctionSelector(manifest.launchStampRouter.atomicSignature)).toBe(manifest.launchStampRouter.atomicSelector);
    for (const event of Object.values(manifest.launchStampRouter.events) as { signature: string; topic0: string }[]) {
      expect(toEventSelector(event.signature)).toBe(event.topic0);
    }
  });
  it("includes every normative permit and stamp input without a fake usable authorization", () => {
    const template = json("direct-launch-request.template.json");
    const abi = json("programmable-launch-stamp-router-v1.json");
    const entry = abi.find((item: { type: string; name: string }) => item.type === "function" && item.name === "launchAndStampV1");
    expect(Object.keys(template.permit)).toEqual(entry.inputs[0].components.map((field: { name: string }) => field.name));
    expect(Object.keys(template.stampRequest)).toEqual(entry.inputs[1].components.map((field: { name: string }) => field.name));
    expect(template.permit.kind).toBe(1);
    expect(template.permitAuthoritySignature).toBeNull();
    expect(template.permit.launchWallet).toBeNull();
  });
});
