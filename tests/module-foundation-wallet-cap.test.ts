import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeAbiParameters } from "viem";
import type { OpenConfigSchema } from "@/packages/classic-modules/src/open-config.mjs";
import { decodeFoundationFieldsV1, presentFoundationFieldsV1 } from "@/lib/module-foundation/presentation";
import { FOUNDATION_PERCENT_BPS_UNIT_V1 } from "@/lib/module-foundation/percentage";
import { createFoundationModuleManifestV1, encodeFoundationConfigurationV1 } from "@/lib/module-foundation/manifest";
import { validateModuleSubmissionRequest } from "@/packages/classic-modules/src/open-transport.mjs";

const schema: OpenConfigSchema = { type: "record", fields: {
  supplyLimitBps: { type: "uint", bits: 16, min: "1", max: "10000", unit: FOUNDATION_PERCENT_BPS_UNIT_V1, label: "Supply limit per wallet (%)" },
  durationMinutes: { type: "uint", bits: 32, min: "1", max: "4294967295", unit: "minutes", label: "Protection duration (minutes)" },
}, required: ["supplyLimitBps", "durationMinutes"] };
const defaults = { supplyLimitBps: "200", durationMinutes: "3" };

describe("optional launch wallet cap configuration", () => {
  let packageDirectory: string;
  beforeAll(() => {
    packageDirectory = mkdtempSync(join(tmpdir(), "programmable-wallet-cap-"));
    execFileSync(process.execPath, [resolve("contracts/scripts/build-launch-wallet-cap-package.mjs"), packageDirectory], { stdio: "pipe" });
  });
  afterAll(() => { if (packageDirectory) rmSync(packageDirectory, { recursive: true }); });
  it("shows exact percentages and independently editable minutes", () => {
    expect(presentFoundationFieldsV1(schema, defaults)).toMatchObject([
      { key: "/supplyLimitBps", kind: "decimal", defaultValue: "2" },
      { key: "/durationMinutes", kind: "integer", defaultValue: "3" },
    ]);
    expect(decodeFoundationFieldsV1(schema, { "/supplyLimitBps": "0.25", "/durationMinutes": "17" }, defaults))
      .toEqual({ supplyLimitBps: "25", durationMinutes: "17" });
    expect(decodeFoundationFieldsV1(schema, { "/durationMinutes": "5" }, defaults))
      .toEqual({ supplyLimitBps: "200", durationMinutes: "5" });
    for (const percent of ["100.01", "2.001", "1e2", "-1", ""]) {
      expect(() => decodeFoundationFieldsV1(schema, { "/supplyLimitBps": percent }, defaults)).toThrow();
    }
  });

  it("preserves ordinary integer-unit fields", () => {
    const ordinary: OpenConfigSchema = { type: "uint", bits: 16, min: "1", max: "10000", unit: "bps" };
    expect(presentFoundationFieldsV1(ordinary, "200")[0]).toMatchObject({ kind: "integer", defaultValue: "200" });
    expect(decodeFoundationFieldsV1(ordinary, { $value: "125" }, "200")).toBe("125");
  });

  it("binds the actual source package and encodes selected percentages and minutes exactly", () => {
    const checked = validateModuleSubmissionRequest(JSON.parse(readFileSync(join(packageDirectory, "source-package.json"), "utf8")));
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
    const manifest = createFoundationModuleManifestV1(checked.request.descriptor, checked.requestDigest);
    const runtime = checked.request.descriptor.extensions!["programmable.module-foundation@1"] as { defaults: typeof defaults };
    const form = decodeFoundationFieldsV1(manifest.sourceDescriptor.configuration,
      { "/supplyLimitBps": "7.25", "/durationMinutes": "11" }, runtime.defaults);
    const encoded = encodeFoundationConfigurationV1(manifest, form);
    expect(decodeAbiParameters([{ type: "uint16" }, { type: "uint32" }], encoded.configuration)).toEqual([725, 11]);
    expect(() => encodeFoundationConfigurationV1(manifest, { supplyLimitBps: "0", durationMinutes: "3" })).toThrow();
    expect(() => encodeFoundationConfigurationV1(manifest, { supplyLimitBps: "200", durationMinutes: "0" })).toThrow();
  });
});
