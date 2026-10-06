import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeAbiParameters, toFunctionSelector, type Address } from "viem";
import { decodeFoundationFieldsV1, presentFoundationFieldsV1 } from "@/lib/module-foundation/presentation";
import { createFoundationModuleManifestV1, encodeFoundationActionV1, encodeFoundationConfigurationV1, hashFoundationModuleDescriptorV1, readFoundationPackageExtensionV1 } from "@/lib/module-foundation/manifest";
import { validateModuleSubmissionRequest } from "@/packages/classic-modules/src/open-transport.mjs";

const ids = ["buyback-burn", "dip-buyback", "lp-rewards", "full-range-lp", "buyer-rewards", "nth-buy-pot", "king-of-the-hill", "hot-potato", "plague", "reactive-pair", "entangled"] as const;
type Id = typeof ids[number];
const quote = "0x1111111111111111111111111111111111111111" as Address;
const context = (decimals: number, chainId = 1) => ({ assets: { quote: { address: quote, decimals, chainId } } });

describe("shared economic module packages", () => {
  let directory: string;
  const manifests = {} as Record<Id, ReturnType<typeof createFoundationModuleManifestV1>>;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "programmable-economic-modules-"));
    execFileSync(process.execPath, [resolve("contracts/scripts/build-economic-module-packages.mjs"), directory], { stdio: "pipe" });
    for (const id of ids) {
      const request = JSON.parse(readFileSync(join(directory, id, "source-package.json"), "utf8"));
      const checked = validateModuleSubmissionRequest(request);
      if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
      manifests[id] = createFoundationModuleManifestV1(checked.request.descriptor, checked.requestDigest);
      for (const file of request.files) {
        expect(createHash("sha256").update(Buffer.from(file.bytes, "base64")).digest("hex")).toBe(file.sha256);
      }
    }
  }, 20000);
  afterAll(() => { if (directory) rmSync(directory, { recursive: true }); });

  function form(id: Id, values: Record<string, string>, decimals = 18, chainId = 1) {
    const manifest = manifests[id];
    const runtime = readFoundationPackageExtensionV1(manifest);
    const decoded = decodeFoundationFieldsV1(manifest.sourceDescriptor.configuration, values, runtime.defaults, context(decimals, chainId));
    return encodeFoundationConfigurationV1(manifest, decoded, context(decimals, chainId)).configuration;
  }

  it("binds eleven distinct identities and unchanged descriptors to both chains without activating them", () => {
    const candidates = JSON.parse(readFileSync(join(directory, "candidates.json"), "utf8"));
    expect(candidates.map((c: { id: string }) => c.id)).toEqual(ids);
    const descriptors = ids.map(id => readFoundationPackageExtensionV1(manifests[id]).descriptor);
    expect(new Set(descriptors.map(d => d.moduleId)).size).toBe(11);
    expect(new Set(descriptors.map(d => d.exclusiveGroup)).size).toBe(11);
    candidates.forEach((c: { requiredChainIds: number[]; available: boolean; descriptorHash: string }, index: number) => {
      expect(c.requiredChainIds).toEqual([1, 4663]);
      expect(c.available).toBe(false);
      expect(c.descriptorHash).toBe(hashFoundationModuleDescriptorV1(descriptors[index]));
    });
  });

  it("converts human quote amounts using the selected quote decimals on either chain", () => {
    for (const chain of [1, 4663]) for (const decimals of [6, 18]) {
      const values = decodeAbiParameters([{ type: "uint128" }, { type: "uint128" }, { type: "uint32" }, { type: "uint32" }, { type: "uint16" }, { type: "uint16" }],
        form("buyback-burn", { "/minimumBudget": "1.25", "/maximumBatch": "2.5" }, decimals, chain));
      expect(values).toEqual([125n * 10n ** BigInt(decimals - 2), 250n * 10n ** BigInt(decimals - 2), 300, 300, 500, 0]);
    }
  });

  it("requires quote metadata and rejects fractional raw units, exponent input and unsafe batches", () => {
    const schema = manifests["buyback-burn"].sourceDescriptor.configuration;
    const defaults = readFoundationPackageExtensionV1(manifests["buyback-burn"]).defaults;
    expect(presentFoundationFieldsV1(schema, defaults).find(f => f.key === "/minimumBudget")).toMatchObject({ kind: "decimal" });
    expect(() => decodeFoundationFieldsV1(schema, { "/minimumBudget": "1" }, defaults)).toThrow(/quote token/);
    for (const amount of ["0", "-1", "1e6", "0.0000001", "1.0000000000000000001"]) {
      expect(() => form("buyback-burn", { "/minimumBudget": amount, "/maximumBatch": "5" }, 6)).toThrow();
    }
    expect(() => form("buyback-burn", { "/minimumBudget": "6", "/maximumBatch": "5" })).toThrow(/maximum batch/);
  });

  it("hides irrelevant settings and converts the token balance rule independently of quote decimals", () => {
    const manifest = manifests.plague;
    const defaults = readFoundationPackageExtensionV1(manifest).defaults;
    expect(presentFoundationFieldsV1(manifest.sourceDescriptor.configuration, defaults, context(6)))
      .toMatchObject([{ key: "/minimum", kind: "decimal", defaultValue: "1" }]);
    expect(decodeAbiParameters([{ type: "uint128" }, { type: "uint32" }], form("plague", { "/minimum": "0.5" }, 6)))
      .toEqual([500000000000000000n, 0]);
    const lp = manifests["lp-rewards"];
    expect(presentFoundationFieldsV1(lp.sourceDescriptor.configuration, readFoundationPackageExtensionV1(lp).defaults).map(f => f.key))
      .toEqual(["/intervalSeconds", "/maximumBatch", "/minimumBudget"]);
    expect(() => form("hot-potato", { "/minimum": "1", "/pauseSeconds": "3601" })).toThrow();
  });

  it("rejects inverted reference caps before the wallet opens", () => {
    expect(() => form("reactive-pair", { "/referenceHost": quote, "/minimumCapBps": "5", "/baseCapBps": "1" })).toThrow(/minimum/);
    expect(() => form("reactive-pair", { "/referenceHost": quote, "/baseCapBps": "8", "/maximumCapBps": "5" })).toThrow(/maximum/);
  });

  it("exposes exact public action bytes and limits reward payment lists", () => {
    for (const id of ids.slice(0, 4)) {
      expect(encodeFoundationActionV1(manifests[id], "execute", {}).data).toBe(toFunctionSelector("execute()"));
      expect(manifests[id].sourceDescriptor.management.actions[0].role).toBe("public");
    }
    for (const id of ids.slice(4, 7)) {
      const encoded = encodeFoundationActionV1(manifests[id], "pay", { beneficiaries: [quote] }).data;
      expect(encoded.slice(0, 10)).toBe(toFunctionSelector("pay(address[])"));
      expect(decodeAbiParameters([{ type: "address[]" }], `0x${encoded.slice(10)}`)).toEqual([[quote]]);
      expect(() => encodeFoundationActionV1(manifests[id], "pay", { beneficiaries: [] })).toThrow();
      expect(() => encodeFoundationActionV1(manifests[id], "pay", { beneficiaries: Array(17).fill(quote) })).toThrow();
    }
  });
});
