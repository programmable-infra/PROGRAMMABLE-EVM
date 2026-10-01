/** Explicit schema unit: an integer in ABI bytes, displayed as an exact percentage in the form. */
export const FOUNDATION_PERCENT_BPS_UNIT_V1 = "programmable.percent-bps";

export function foundationPercentFromBpsV1(value: string | number): string {
  const input = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(input) || BigInt(input) > 10_000n) throw new Error("Invalid percentage basis points.");
  const bps = BigInt(input), fraction = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${bps / 100n}${fraction ? `.${fraction}` : ""}`;
}

export function foundationPercentToBpsV1(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,2})?$/.test(value)) {
    throw new Error("Enter a percentage from 0% to 100% with at most two decimal places.");
  }
  const [whole, fraction = ""] = value.split("."), bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (bps > 10_000n) throw new Error("The percentage cannot exceed 100%.");
  return bps.toString();
}
