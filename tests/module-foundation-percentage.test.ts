import { describe, expect, it } from "vitest";
import { compileOpenConfig, type OpenConfigSchema } from "@/packages/classic-modules/src/open-config.mjs";
import { decodeFoundationFieldsV1, presentFoundationFieldsV1 } from "@/lib/module-foundation/presentation";
import { FOUNDATION_PERCENT_BPS_UNIT_V1, foundationPercentFromBpsV1, foundationPercentToBpsV1 } from "@/lib/module-foundation/percentage";

describe("schema-bounded module percentages", () => {
  const schema: OpenConfigSchema = { type: "record", required: ["unlockRiseBps"], fields: {
    unlockRiseBps: { type: "uint", bits: 16, min: "1", max: "65535", unit: FOUNDATION_PERCENT_BPS_UNIT_V1 },
  } };
  const defaults = { unlockRiseBps: "1000" };

  it("presents Entangled's published range without disabling its default form", () => {
    expect(presentFoundationFieldsV1(schema, defaults)).toMatchObject([{
      key: "/unlockRiseBps", kind: "decimal", defaultValue: "10",
      description: "Range: 0.01% to 655.35%. Up to two decimal places.",
    }]);
  });

  it.each([["0.01", "1"], ["10", "1000"], ["100.01", "10001"], ["655.35", "65535"]])(
    "converts %s percent to the exact declared basis points", (input, expected) => {
      const decoded = decodeFoundationFieldsV1(schema, { "/unlockRiseBps": input }, defaults);
      expect(decoded).toEqual({ unlockRiseBps: expected });
      expect(() => compileOpenConfig(schema, decoded)).not.toThrow();
    },
  );

  it.each(["655.36", "-1", "1e2", "1.001", "01", "Infinity", "9".repeat(82)])(
    "rejects out-of-range or inexact form input %s", input => {
      expect(() => decodeFoundationFieldsV1(schema, { "/unlockRiseBps": input }, defaults)).toThrow();
    },
  );

  it("keeps the schema minimum and default 100% maximum enforced", () => {
    const decoded = decodeFoundationFieldsV1(schema, { "/unlockRiseBps": "0" }, defaults);
    expect(() => compileOpenConfig(schema, decoded)).toThrow();
    expect(foundationPercentToBpsV1("100")).toBe("10000");
    expect(() => foundationPercentToBpsV1("100.01")).toThrow();
    expect(() => foundationPercentFromBpsV1("10001")).toThrow();
    expect(() => foundationPercentToBpsV1("5.01", "500")).toThrow();
  });
});
