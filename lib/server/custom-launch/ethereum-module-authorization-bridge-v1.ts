import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { getAddress, type Address } from "viem";
import { parseStrictJson, type JsonValue } from "../projection-target/canonical-json";
import { createPrivyWalletPrincipalAuthenticatorV1, WalletPrincipalAuthenticationErrorV1, type WalletPrincipalAuthenticatorV1 } from "../creator-article/wallet-principal.server";
import { PreservedBackendPublicErrorV1, readPreservedBackendPublicErrorV1 } from "./backend-public-error-v1";
import { createWalletAdminBffAssertionV2, requireWalletAdminBffAssertionKeyV2 } from "./wallet-admin-bff-assertion-v2";
import { parseEthereumModuleAuthorization, type EthereumModuleAuthorization, type EthereumModuleAuthorizationRequest } from "@/lib/module-foundation/ethereum-authorization";
const AUTHORIZATION_PATH = "/v1/wallet-admin/module-launches/ethereum/authorization";
const MAXIMUM_BACKEND_BODY_BYTES = 524_288;
const DEFAULT_BACKEND_TIMEOUT_MS = 60_000;
export class EthereumModuleAuthorizationBridgeErrorV1 extends Error {
  constructor(readonly status: number, readonly code: string, readonly requestId: string | null = null, readonly retryAfter: string | null = null) { super(code); }
}
export interface EthereumModuleAuthorizationBridgeV1 {
  authorize(request: Request, input: EthereumModuleAuthorizationRequest): Promise<EthereumModuleAuthorization>;
}
export function createEthereumModuleAuthorizationBridgeV1(input: Readonly<{
  authenticator: WalletPrincipalAuthenticatorV1;
  backendBaseUrl: string;
  websiteToken: string;
  bffAssertionKeyV2: string;
  fetchBackend: typeof fetch;
  backendTimeoutMs?: number;
  assertionNow?: () => Date;
  assertionNonce?: () => string;
}>): EthereumModuleAuthorizationBridgeV1 {
  const backendBaseUrl = normalizedBackendBaseUrl(input.backendBaseUrl);
  const websiteToken = boundedWebsiteToken(input.websiteToken);
  const assertionKey = requireWalletAdminBffAssertionKeyV2(
    input.bffAssertionKeyV2,
    websiteToken,
  );
  const timeoutMs = input.backendTimeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
  const assertionNow = input.assertionNow ?? (() => new Date());
  const assertionNonce = input.assertionNonce
    ?? (() => randomBytes(16).toString("base64url"));
  if (
    typeof input.authenticator?.authenticate !== "function"
    || typeof input.fetchBackend !== "function"
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1_000
    || timeoutMs > 60_000
  ) throw new TypeError("Ethereum module bridge configuration is invalid");

  const bridge: EthereumModuleAuthorizationBridgeV1 = {
    async authorize(request, rawInput) {
      try {
        const requestInput = rawInput;
        const principal = await input.authenticator.authenticate(request);
        const launchWallet = requireLinkedWallet(
          principal.wallets,
          requestInput.launchWallet,
        );
        const body = Object.freeze({
          ...requestInput,
          launchWallet,
        });
        const bodyBytes = Buffer.from(JSON.stringify(body), "utf8");
        const backendUrl = new URL(AUTHORIZATION_PATH, backendBaseUrl);
        const assertion = createWalletAdminBffAssertionV2({
          method: "POST",
          requestTarget: backendUrl.pathname,
          privyUserId: principal.privyUserId,
          walletAddress: launchWallet,
          issuedAt: assertionNow().toISOString(),
          nonce: assertionNonce(),
          bodyBytes,
          assertionKey,
        });
        const signal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(timeoutMs),
        ]);
        const response = await input.fetchBackend(backendUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${websiteToken}`,
            "Content-Type": "application/json",
            "X-Programmable-Privy-User-Id": principal.privyUserId,
            "X-Programmable-Wallet-Address": launchWallet,
            ...assertion,
          },
          body: bodyBytes,
          cache: "no-store",
          redirect: "error",
          signal,
        });
        if (!response.ok) throw await mappedBackendError(response);
        if (response.status !== 200) throw new BackendContractErrorV1();
        return parseEthereumModuleAuthorization(
          await readBoundedBackendJson(response),
          requestInput,
        );
      } catch (error) {
        if (error instanceof EthereumModuleAuthorizationBridgeErrorV1) {
          throw error;
        }
        if (error instanceof WalletPrincipalAuthenticationErrorV1) {
          throw new EthereumModuleAuthorizationBridgeErrorV1(
            error.status,
            error.code,
          );
        }
        if (error instanceof PreservedBackendPublicErrorV1) {
          throw new EthereumModuleAuthorizationBridgeErrorV1(
            error.status,
            error.code,
            error.requestId,
            error.retryAfter,
          );
        }
        const requestId = randomUUID();
        console.error("Ethereum module authorization bridge failed", {
          name: error instanceof Error ? error.name : "EthereumModuleAuthorizationError",
          requestId,
        });
        throw new EthereumModuleAuthorizationBridgeErrorV1(
          503,
          "MODULE_LAUNCH_AUTHORIZATION_UNAVAILABLE",
          requestId,
        );
      }
    },
  };
  return Object.freeze(bridge);
}

let productionBridge: EthereumModuleAuthorizationBridgeV1 | null = null;

export function getProductionEthereumModuleAuthorizationBridgeV1() {
  productionBridge ??= createEthereumModuleAuthorizationBridgeV1({
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    backendBaseUrl: requiredEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL",
    ),
    websiteToken: requiredEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN",
    ),
    bffAssertionKeyV2: requiredRawEnvironment(
      "PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2",
    ),
    fetchBackend: fetch,
  });
  return productionBridge;
}

async function readBoundedBackendJson(response: Response): Promise<JsonValue> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAXIMUM_BACKEND_BODY_BYTES
  ) throw new BackendContractErrorV1();
  const text = await response.text();
  if (!text || Buffer.byteLength(text, "utf8") > MAXIMUM_BACKEND_BODY_BYTES) {
    throw new BackendContractErrorV1();
  }
  try {
    return parseStrictJson(text, {
      maximumBytes: MAXIMUM_BACKEND_BODY_BYTES,
      maximumDepth: 16,
    });
  } catch {
    throw new BackendContractErrorV1();
  }
}

async function mappedBackendError(response: Response) {
  const preserved = await readPreservedBackendPublicErrorV1(response);
  return preserved ?? new BackendContractErrorV1();
}

function requireLinkedWallet(
  wallets: readonly `0x${string}`[],
  candidate: Address,
): Address {
  const wallet = getAddress(candidate);
  if (!wallets.some((entry) => entry.toLowerCase() === wallet.toLowerCase())) {
    throw new EthereumModuleAuthorizationBridgeErrorV1(
      403,
      "wallet_not_linked",
    );
  }
  return wallet;
}

function normalizedBackendBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Custom launch API base URL is invalid");
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    (url.protocol !== "https:" && !localHttp)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) throw new TypeError("Custom launch API base URL is invalid");
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url;
}

function boundedWebsiteToken(value: string) {
  if (
    typeof value !== "string"
    || value.length < 43
    || value.length > 512
    || /[\s\u0000]/u.test(value)
  ) throw new TypeError("Custom launch Website token is invalid");
  return value;
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function requiredRawEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

class BackendContractErrorV1 extends Error {
  constructor() {
    super("Ethereum module backend contract is invalid");
    this.name = "BackendContractErrorV1";
  }
}
