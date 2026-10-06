/** Explicit schema unit: an integer in ABI bytes, displayed as an exact percentage in the form. */
export const FOUNDATION_PERCENT_BPS_UNIT_V1 = "programmable.percent-bps";

function unsignedBps(value: string | number): bigint {
  const input = String(value);
  if ((typeof value === "number" && !Number.isSafeInteger(value)) || input.length > 78
    || !/^(?:0|[1-9][0-9]*)$/.test(input) || BigInt(input) >= (1n << 256n)) throw new Error("Invalid percentage basis points.");
  return BigInt(input);
}

export function foundationPercentFromBpsV1(value: string | number, maximum: string | number = "10000"): string {
  const bps = unsignedBps(value);
  if (bps > unsignedBps(maximum)) throw new Error("Invalid percentage basis points.");
  const fraction = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${bps / 100n}${fraction ? `.${fraction}` : ""}`;
}

export function foundationPercentToBpsV1(value: unknown, maximum: string | number = "10000"): string {
  if (typeof value !== "string" || value.length > 81 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value)) {
    throw new Error("Enter a non-negative percentage with at most two decimal places.");
  }
  const [whole, fraction = ""] = value.split("."), bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (bps > unsignedBps(maximum)) throw new Error(`The percentage cannot exceed ${foundationPercentFromBpsV1(maximum, maximum)}%.`);
  return bps.toString();
}
