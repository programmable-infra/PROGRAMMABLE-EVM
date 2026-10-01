import { describe, expect, it, vi } from "vitest";

import {
  loginConnectedEthereumWalletWithSiwe,
  selectInjectedEthereumProvider,
  type InjectedEthereumProvider,
} from "../lib/wallet-siwe-login";

const DEV_WALLET = "0x2Bb333d48DFAF1596D9036671d2E43168994249E";
const OLD_WALLET = "0xe1939B7a5a6840f061299de8246071891c4D81e9";

describe("connected wallet SIWE login", () => {
  it("prefers MetaMask when multiple injected providers are present", () => {
    const first = { request: vi.fn() };
    const metamask = { isMetaMask: true, request: vi.fn() };
    const injected = {
      request: vi.fn(),
      providers: [first, metamask],
    };

    expect(selectInjectedEthereumProvider(injected)).toBe(metamask);
  });

  it("authenticates an already connected wallet without requesting permissions", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_accounts") return [DEV_WALLET];
      if (method === "eth_chainId") return "0x1";
      if (method === "personal_sign") return `0x${"ab".repeat(65)}`;
      throw new Error(`Unexpected method: ${method}`);
    });
    const generateSiweMessage = vi.fn(async () => "programmable.test wants you to sign in");
    const loginWithSiwe = vi.fn(async () => ({ id: "did:privy:test" }));

    await expect(loginConnectedEthereumWalletWithSiwe({
      provider: { isMetaMask: true, request } as InjectedEthereumProvider,
      generateSiweMessage,
      loginWithSiwe,
    })).resolves.toBe(true);

    expect(request.mock.calls.map(([input]) => input.method)).toEqual([
      "eth_accounts",
      "eth_chainId",
      "personal_sign",
    ]);
    expect(request.mock.calls.some(([input]) =>
      input.method === "wallet_requestPermissions"
    )).toBe(false);
    expect(generateSiweMessage).toHaveBeenCalledWith({
      address: DEV_WALLET,
      chainId: "eip155:1",
      disableSignup: true,
    });
    expect(loginWithSiwe).toHaveBeenCalledWith(expect.objectContaining({
      connectorType: "injected",
      disableSignup: true,
      walletClientType: "metamask",
    }));
  });

  it("falls back to the regular connector when no account is connected", async () => {
    const request = vi.fn(async () => []);
    const generateSiweMessage = vi.fn();
    const loginWithSiwe = vi.fn();

    await expect(loginConnectedEthereumWalletWithSiwe({
      provider: { request } as InjectedEthereumProvider,
      generateSiweMessage,
      loginWithSiwe,
    })).resolves.toBe(false);

    expect(generateSiweMessage).not.toHaveBeenCalled();
    expect(loginWithSiwe).not.toHaveBeenCalled();
  });

  it("opens MetaMask account selection before signing with the newly selected wallet", async () => {
    let account = OLD_WALLET;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "wallet_requestPermissions") { account = DEV_WALLET; return []; }
      if (method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0x1237";
      if (method === "personal_sign") return `0x${"ab".repeat(65)}`;
      throw new Error(`Unexpected method: ${method}`);
    });
    const generateSiweMessage = vi.fn(async () => "Sign in with the selected wallet");
    const loginWithSiwe = vi.fn(async () => ({}));
    await expect(loginConnectedEthereumWalletWithSiwe({ provider: { isMetaMask: true, request },
      generateSiweMessage, loginWithSiwe, requestAccountSelection: true, expectedAddress: DEV_WALLET,
    })).resolves.toBe(true);
    expect(request.mock.calls[0][0].method).toBe("wallet_requestPermissions");
    expect(generateSiweMessage).toHaveBeenCalledWith(expect.objectContaining({ address: DEV_WALLET }));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: "personal_sign", params: expect.arrayContaining([DEV_WALLET]) }));
  });

  it("does not sign or authenticate the old wallet when an explicit admin account is requested", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => method === "eth_accounts" ? [OLD_WALLET] : []);
    const generateSiweMessage = vi.fn();
    const loginWithSiwe = vi.fn();
    await expect(loginConnectedEthereumWalletWithSiwe({ provider: { isMetaMask: true, request },
      generateSiweMessage, loginWithSiwe, requestAccountSelection: true, expectedAddress: DEV_WALLET,
    })).rejects.toThrow(`Select ${DEV_WALLET}`);
    expect(generateSiweMessage).not.toHaveBeenCalled();
    expect(loginWithSiwe).not.toHaveBeenCalled();
  });

  it("rejects a wallet change while the sign-in signature is pending", async () => {
    let account = DEV_WALLET;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "wallet_requestPermissions") return [];
      if (method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0x1";
      if (method === "personal_sign") { account = OLD_WALLET; return `0x${"ab".repeat(65)}`; }
      throw new Error(`Unexpected method: ${method}`);
    });
    const loginWithSiwe = vi.fn();
    await expect(loginConnectedEthereumWalletWithSiwe({ provider: { isMetaMask: true, request },
      generateSiweMessage: async () => "Sign in", loginWithSiwe, requestAccountSelection: true,
    })).rejects.toThrow("Your wallet account changed");
    expect(loginWithSiwe).not.toHaveBeenCalled();
  });
});
