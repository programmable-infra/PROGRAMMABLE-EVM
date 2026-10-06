import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeAbiParameters } from "viem";
import { decodeFoundationFieldsV1, presentFoundationFieldsV1 } from "@/lib/module-foundation/presentation";
import { createFoundationModuleManifestV1, encodeFoundationConfigurationV1, readFoundationPackageExtensionV1 } from "@/lib/module-foundation/manifest";
import { validateModuleSubmissionRequest } from "@/packages/classic-modules/src/open-transport.mjs";

describe("growing buy limit source package", () => {
  let directory: string;
  let manifest: ReturnType<typeof createFoundationModuleManifestV1>;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "programmable-growing-limit-"));
    execFileSync(process.execPath, [resolve("contracts/scripts/build-growing-buy-limit-package.mjs"), directory], { stdio: "pipe" });
    const checked = validateModuleSubmissionRequest(JSON.parse(readFileSync(join(directory, "source-package.json"), "utf8")));
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
    manifest = createFoundationModuleManifestV1(checked.request.descriptor, checked.requestDigest);
  });
  afterAll(() => { if (directory) rmSync(directory, { recursive: true }); });

  it("turns the visible percentage inputs into the exact contract configuration", () => {
    const runtime = readFoundationPackageExtensionV1(manifest);
    const schema = manifest.sourceDescriptor.configuration;
    expect(presentFoundationFieldsV1(schema, runtime.defaults)).toMatchObject([
      { key: "/durationSeconds", kind: "integer", defaultValue: "600" },
      { key: "/finalLimitBps", kind: "decimal", defaultValue: "5" },
      { key: "/initialLimitBps", kind: "decimal", defaultValue: "0.5" },
    ]);
    const form = decodeFoundationFieldsV1(schema, {
      "/initialLimitBps": "0.25", "/finalLimitBps": "7.5", "/durationSeconds": "90",
    }, runtime.defaults);
    const encoded = encodeFoundationConfigurationV1(manifest, form);
    expect(decodeAbiParameters([{ type: "uint16" }, { type: "uint16" }, { type: "uint32" }], encoded.configuration))
      .toEqual([25, 750, 90]);
  });

  it("rejects decreasing limits and invalid values before requesting a wallet signature", () => {
    const defaults = readFoundationPackageExtensionV1(manifest).defaults as Record<string, string>;
    expect(() => encodeFoundationConfigurationV1(manifest, { ...defaults, initialLimitBps: "501" }))
      .toThrow("The final limit must be at least the initial limit.");
    for (const invalid of [{ initialLimitBps: "0" }, { finalLimitBps: "10001" }, { durationSeconds: "0" }]) {
      expect(() => encodeFoundationConfigurationV1(manifest, { ...defaults, ...invalid })).toThrow();
    }
    expect(() => encodeFoundationConfigurationV1(manifest, { ...defaults, finalLimitBps: defaults.initialLimitBps }))
      .not.toThrow();
  });
});
