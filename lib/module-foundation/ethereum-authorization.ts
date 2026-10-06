import { getAddress, type Address, type Hex } from "viem";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
export interface EthereumModuleAuthorizationRequest {
  schemaVersion: "programmable.ethereum-module-authorization-request.v1"; chainId: "1";
  launchWallet: Address; releaseDigest: Hex; parameters: Hex; fundingPath: Hex; valueWei: string;
}
export interface EthereumModuleAuthorization {
  schemaVersion: "programmable.ethereum-module-authorization.v1"; chainId: "1"; releaseDigest: Hex;
  launchId: Hex; predictedToken: Address; predictedHook: Address; predictedEngine: Address; permitDigest: Hex;
  validAfter: string; deadline: string;
  simulation: { blockNumber: string; blockHash: Hex; gasEstimate: string; stampHash: Hex; providerCount: 2 };
  transaction: { chainId: "1"; from: Address; to: Address; valueWei: string; calldata: Hex; gasLimit: string };
}
function record(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== keys.sort().join()) throw new Error("Invalid Ethereum module authorization.");
  return value as Record<string, unknown>;
}
const hex = (v: unknown, bytes?: number): Hex => {
  if (typeof v !== "string" || !/^0x(?:[a-f0-9]{2})+$/i.test(v) || (bytes && v.length !== bytes * 2 + 2)) throw new Error("Invalid Ethereum authorization bytes.");
  return v as Hex;
};
const decimal = (v: unknown): string => {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= 2n ** 256n) throw new Error("Invalid Ethereum authorization amount.");
  return v;
};
const address = (v: unknown) => { if (typeof v !== "string") throw new Error("Invalid address."); const a = getAddress(v); if (BigInt(a) === 0n) throw new Error("Invalid address."); return a; };
export function parseEthereumModuleAuthorization(value: unknown, input: EthereumModuleAuthorizationRequest): EthereumModuleAuthorization {
  const r = record(value, ["schemaVersion", "chainId", "releaseDigest", "launchId", "predictedToken", "predictedHook", "predictedEngine", "permitDigest", "validAfter", "deadline", "simulation", "transaction"]);
  const s = record(r.simulation, ["blockNumber", "blockHash", "gasEstimate", "stampHash", "providerCount"]);
  const t = record(r.transaction, ["chainId", "from", "to", "valueWei", "calldata", "gasLimit"]);
  if (r.schemaVersion !== "programmable.ethereum-module-authorization.v1" || r.chainId !== "1" || t.chainId !== "1"
    || hex(r.releaseDigest, 32).toLowerCase() !== input.releaseDigest.toLowerCase() || s.providerCount !== 2
    || address(t.from) !== getAddress(input.launchWallet) || address(t.to) !== getAddress(ethereum.canonicalStamp.router.address)
    || decimal(t.valueWei) !== input.valueWei || BigInt(decimal(t.gasLimit)) > 16_777_216n || BigInt(decimal(t.gasLimit)) <= 0n
    || BigInt(decimal(r.deadline)) <= BigInt(decimal(r.validAfter)) || BigInt(decimal(r.deadline)) - BigInt(decimal(r.validAfter)) > 330n) throw new Error("The Ethereum module authorization changed.");
  return { schemaVersion: "programmable.ethereum-module-authorization.v1", chainId: "1", releaseDigest: hex(r.releaseDigest, 32),
    launchId: hex(r.launchId, 32), predictedToken: address(r.predictedToken), predictedHook: address(r.predictedHook), predictedEngine: address(r.predictedEngine), permitDigest: hex(r.permitDigest, 32),
    validAfter: decimal(r.validAfter), deadline: decimal(r.deadline),
    simulation: { blockNumber: decimal(s.blockNumber), blockHash: hex(s.blockHash, 32), gasEstimate: decimal(s.gasEstimate), stampHash: hex(s.stampHash, 32), providerCount: 2 },
    transaction: { chainId: "1", from: address(t.from), to: address(t.to), valueWei: decimal(t.valueWei), calldata: hex(t.calldata), gasLimit: decimal(t.gasLimit) } };
}
export class EthereumModuleAuthorizationError extends Error {
  constructor(readonly status: number, readonly code: string, readonly requestId: string | null) {
    super(status === 401 ? "Your wallet session expired. Connect your wallet again."
      : status === 429 ? "Too many launch preparations. Wait a moment and try again."
      : status === 400 ? "These launch settings could not be prepared. Check your coin details and try again."
      : "The launch service could not prepare your transaction. Try again. Your coin details are kept.");
    this.name = "EthereumModuleAuthorizationError";
  }
}
export async function requestEthereumModuleAuthorization(input: EthereumModuleAuthorizationRequest, accessToken: string, signal?: AbortSignal) {
  const response = await fetch("/api/module-foundation/authorize", { method: "POST", credentials: "same-origin", redirect: "error", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(input) });
  if (!response.ok) {
    let code = "MODULE_LAUNCH_AUTHORIZATION_UNAVAILABLE", requestId: string | null = null;
    try {
      const text = await response.text();
      if (text.length <= 4_096) {
        const error = JSON.parse(text);
        if (typeof error?.code === "string" && /^[A-Za-z0-9_]{1,100}$/.test(error.code)) code = error.code;
        if (typeof error?.requestId === "string" && /^[a-f0-9-]{36}$/i.test(error.requestId)) requestId = error.requestId;
      }
    } catch { /* The status remains usable when a proxy returns a non-JSON error. */ }
    throw new EthereumModuleAuthorizationError(response.status, code, requestId);
  }
  const text = await response.text(); if (text.length > 524_288) throw new Error("The launch authorization is too large.");
  return parseEthereumModuleAuthorization(JSON.parse(text), input);
}
