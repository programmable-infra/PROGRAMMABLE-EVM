import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createEthereumModuleAuthorizationBridgeV1 } from "../lib/server/custom-launch/ethereum-module-authorization-bridge-v1";
import { ETHEREUM_MODULE_SOURCE } from "../lib/module-foundation/ethereum-release";
import { parseEthereumModuleAuthorization, requestEthereumModuleAuthorization, type EthereumModuleAuthorizationRequest } from "../lib/module-foundation/ethereum-authorization";
const wallet = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"ab".repeat(32)}` as const;
const request: EthereumModuleAuthorizationRequest = { schemaVersion: "programmable.ethereum-module-authorization-request.v1", chainId: "1", launchWallet: wallet, releaseDigest: ETHEREUM_MODULE_SOURCE.releaseDigest, parameters: "0x1234", fundingPath: "0x1234", valueWei: "100" };
const response = () => ({ schemaVersion: "programmable.ethereum-module-authorization.v1", chainId: "1", releaseDigest: request.releaseDigest, launchId: hash, predictedToken: wallet, predictedHook: wallet, predictedEngine: wallet, permitDigest: hash,
 validAfter: "2000000000", deadline: "2000000300", simulation: { blockNumber: "26125737", blockHash: hash, gasEstimate: "7887366", stampHash: hash, providerCount: 2 },
 transaction: { chainId: "1", from: wallet, to: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56", valueWei: "100", calldata: "0xabcd", gasLimit: "9000000" } });
describe("Ethereum module authorization boundary", () => {
 afterEach(() => vi.unstubAllGlobals());
 const authenticate = vi.fn(), fetchBackend = vi.fn();
 beforeEach(() => { vi.clearAllMocks(); authenticate.mockResolvedValue({ privyUserId: "did:privy:test", wallets: [wallet] }); fetchBackend.mockImplementation(async () => Response.json(response())); });
 const bridge = () => createEthereumModuleAuthorizationBridgeV1({ authenticator: { authenticate }, backendBaseUrl: "https://example.test", websiteToken: "w".repeat(43), bffAssertionKeyV2: "b".repeat(43), fetchBackend });
 it("retains a safe server error identity without rendering arbitrary server text or looping requests", async () => {
   const requestId = "f778b220-d73f-420d-af7d-deee32c80f80";
   const fetcher = vi.fn(async () => Response.json({ code: "WALLET_ADMIN_UNAVAILABLE", requestId, message: "private provider detail" }, { status: 503 }));
   vi.stubGlobal("fetch", fetcher);
   await expect(requestEthereumModuleAuthorization(request, "test-access")).rejects.toMatchObject({
     name: "EthereumModuleAuthorizationError", code: "WALLET_ADMIN_UNAVAILABLE", requestId, status: 503,
     message: "The launch service could not prepare your transaction. Try again. Your coin details are kept.",
   });
   expect(fetcher).toHaveBeenCalledOnce();
 });
 it("authenticates the selected wallet and signs the exact backend path and body", async () => {
   await expect(bridge().authorize(new Request("https://programmable.market/api/module-foundation/authorize"), request)).resolves.toMatchObject({ chainId: "1", releaseDigest: request.releaseDigest });
   const [url, init] = fetchBackend.mock.calls[0];
   expect(url.pathname).toBe("/v1/wallet-admin/module-launches/ethereum/authorization");
   expect(JSON.parse(String(init.body))).toEqual(request);
   expect(new Headers(init.headers).get("x-programmable-bff-assertion-version")).toBe("2");
   expect(init.redirect).toBe("error");
 });
 it("preserves the module authority's own unavailable code and retry identity", async () => {
   const requestId = "f778b220-d73f-420d-af7d-deee32c80f80";
   fetchBackend.mockResolvedValueOnce(Response.json({ schemaVersion: "programmable.api-error.v1", error: {
     code: "MODULE_LAUNCH_AUTHORIZATION_UNAVAILABLE", message: "The launch service is unavailable.", requestId,
   } }, { status: 503, headers: { "Retry-After": "30" } }));
   await expect(bridge().authorize(new Request("https://programmable.market"), request)).rejects.toMatchObject({
     status: 503, code: "MODULE_LAUNCH_AUTHORIZATION_UNAVAILABLE", requestId, retryAfter: "30",
   });
 });
 it("never forwards an unlinked wallet", async () => {
   await expect(bridge().authorize(new Request("https://programmable.market"), { ...request, launchWallet: "0x2222222222222222222222222222222222222222" })).rejects.toMatchObject({ status: 403, code: "wallet_not_linked" });
   expect(fetchBackend).not.toHaveBeenCalled();
 });
 it.each(["valueWei", "from", "to", "chainId"] as const)("rejects a changed transaction %s", field => {
   const candidate = response(); (candidate.transaction as Record<string, string>)[field] = field === "from" || field === "to" ? "0x2222222222222222222222222222222222222222" : "2";
   expect(() => parseEthereumModuleAuthorization(candidate, request)).toThrow();
 });
 it("rejects unrecognized response authority and a single provider", () => {
   expect(() => parseEthereumModuleAuthorization({ ...response(), verified: true }, request)).toThrow();
   const candidate = response(); candidate.simulation.providerCount = 1;
   expect(() => parseEthereumModuleAuthorization(candidate, request)).toThrow();
 });
});
