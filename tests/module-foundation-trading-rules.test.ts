import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeAbiParameters } from "viem";
import { decodeFoundationFieldsV1, presentFoundationFieldsV1 } from "@/lib/module-foundation/presentation";
import { createFoundationModuleManifestV1, encodeFoundationConfigurationV1, readFoundationPackageExtensionV1 } from "@/lib/module-foundation/manifest";
import { validateModuleSubmissionRequest } from "@/packages/classic-modules/src/open-transport.mjs";

const ids = ["buy-cooldown", "buy-window", "price-move-guard"] as const;
type Id = typeof ids[number];
type Manifest = ReturnType<typeof createFoundationModuleManifestV1>;

describe("shared trading rule source packages", () => {
  let directory: string;
  const manifests = {} as Record<Id, Manifest>;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "programmable-trading-rules-"));
    for (const id of ids) {
      const output = join(directory, id);
      execFileSync(process.execPath, [resolve("contracts/scripts/build-trading-rule-package.mjs"), id, output], { stdio: "pipe" });
      const checked = validateModuleSubmissionRequest(JSON.parse(readFileSync(join(output, "source-package.json"), "utf8")));
      if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
      manifests[id] = createFoundationModuleManifestV1(checked.request.descriptor, checked.requestDigest);
    }
  });
  afterAll(() => { if (directory) rmSync(directory, { recursive: true }); });

  function form(id: Id, values: Record<string, string>) {
    const manifest = manifests[id];
    const runtime = readFoundationPackageExtensionV1(manifest);
    const decoded = decodeFoundationFieldsV1(manifest.sourceDescriptor.configuration, values, runtime.defaults);
    return encodeFoundationConfigurationV1(manifest, decoded).configuration;
  }

  it("uses distinct module identities and exclusive groups so the three rules can coexist", () => {
    const descriptors = ids.map(id => readFoundationPackageExtensionV1(manifests[id]).descriptor);
    expect(new Set(descriptors.map(d => d.moduleId)).size).toBe(3);
    expect(new Set(descriptors.map(d => d.exclusiveGroup)).size).toBe(3);
    for (const d of descriptors) {
      expect(d.resources).toBe(0);
      expect(d.actionGas).toBe(0);
      expect(d.failOpenAfter).toBe(false);
    }
  });

  it("encodes cooldown seconds and rejects zero, fractional and excessive waits before signing", () => {
    const manifest = manifests["buy-cooldown"];
    const defaults = readFoundationPackageExtensionV1(manifest).defaults;
    expect(presentFoundationFieldsV1(manifest.sourceDescriptor.configuration, defaults))
      .toMatchObject([{ key: "/cooldownSeconds", kind: "integer", defaultValue: "30" }]);
    expect(decodeAbiParameters([{ type: "uint32" }], form("buy-cooldown", { "/cooldownSeconds": "60" }))).toEqual([60]);
    for (const value of ["0", "1.5", "86401"]) {
      expect(() => form("buy-cooldown", { "/cooldownSeconds": value })).toThrow();
    }
  });

  it("supports a UTC window that crosses midnight and rejects invalid hours", () => {
    expect(decodeAbiParameters([{ type: "uint8" }, { type: "uint8" }], form("buy-window", {}))).toEqual([8, 12]);
    expect(decodeAbiParameters([{ type: "uint8" }, { type: "uint8" }],
      form("buy-window", { "/startHourUtc": "21", "/openHours": "4" }))).toEqual([21, 4]);
    const invalidValues: Record<string, string>[] = [{ "/startHourUtc": "24" }, { "/startHourUtc": "-1" }, { "/openHours": "0" }, { "/openHours": "24" }];
    for (const invalid of invalidValues) {
      expect(() => form("buy-window", invalid)).toThrow();
    }
  });

  it("shows percentages but passes basis points to the price guard", () => {
    const manifest = manifests["price-move-guard"];
    const defaults = readFoundationPackageExtensionV1(manifest).defaults;
    expect(presentFoundationFieldsV1(manifest.sourceDescriptor.configuration, defaults))
      .toMatchObject([{ key: "/maxMoveBps", kind: "decimal", defaultValue: "10" }]);
    expect(decodeAbiParameters([{ type: "uint16" }], form("price-move-guard", { "/maxMoveBps": "0.25" }))).toEqual([25]);
    for (const value of ["0", "0.001", "50.01"]) {
      expect(() => form("price-move-guard", { "/maxMoveBps": value })).toThrow();
    }
    expect(decodeAbiParameters([{ type: "uint16" }], form("price-move-guard", { "/maxMoveBps": "50" }))).toEqual([5000]);
  });
});
