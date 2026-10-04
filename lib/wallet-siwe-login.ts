import { bytesToHex, getAddress } from "viem";

export type InjectedEthereumProvider = Readonly<{
  isMetaMask?: boolean;
  providers?: readonly unknown[];
  on?: (event: string, listener: (value: unknown) => void) => unknown;
  removeListener?: (event: string, listener: (value: unknown) => void) => unknown;
  request: (input: Readonly<{
    method: string;
    params?: readonly unknown[];
  }>) => Promise<unknown>;
}>;

type GenerateSiweMessage = (input: Readonly<{
  address: string;
  chainId: `eip155:${number}`;
  disableSignup?: boolean;
}>) => Promise<string>;

type LoginWithSiwe = (input: Readonly<{
  signature: string;
  message: string;
  disableSignup?: boolean;
  walletClientType?: string;
  connectorType?: string;
}>) => Promise<unknown>;

export class WalletAccountSelectionError extends Error {}

function isInjectedEthereumProvider(
  candidate: unknown,
): candidate is InjectedEthereumProvider {
  return typeof candidate === "object"
    && candidate !== null
    && "request" in candidate
    && typeof candidate.request === "function";
}

export function selectInjectedEthereumProvider(
  injected: unknown,
): InjectedEthereumProvider | null {
  if (!isInjectedEthereumProvider(injected)) return null;

  const providers = Array.isArray(injected.providers)
    ? injected.providers.filter(isInjectedEthereumProvider)
    : [];

  return providers.find((provider) => provider.isMetaMask)
    ?? (injected.isMetaMask ? injected : null)
    ?? providers[0]
    ?? injected;
}

function parseChainId(value: unknown): number {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error("The connected wallet returned an invalid chain ID");
  }

  const chainId = Number(BigInt(value));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("The connected wallet returned an invalid chain ID");
  }
  return chainId;
}

export async function loginConnectedEthereumWalletWithSiwe(input: Readonly<{
  provider: InjectedEthereumProvider;
  generateSiweMessage: GenerateSiweMessage;
  loginWithSiwe: LoginWithSiwe;
  requestAccountSelection?: boolean;
  expectedAddress?: string;
  disableSignup?: boolean;
}>): Promise<boolean> {
  if (input.requestAccountSelection) {
    await input.provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  }
  const accounts = await input.provider.request({ method: "eth_accounts" });
  const account = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof account !== "string") {
    if (input.requestAccountSelection) throw new WalletAccountSelectionError("Choose an account in MetaMask to continue.");
    return false;
  }

  const address = getAddress(account);
  if (input.expectedAddress && address.toLowerCase() !== input.expectedAddress.toLowerCase()) {
    throw new WalletAccountSelectionError(`Select ${input.expectedAddress} in MetaMask and connect only that account.`);
  }
  const chainId = parseChainId(
    await input.provider.request({ method: "eth_chainId" }),
  );
  const message = await input.generateSiweMessage({
    address,
    chainId: `eip155:${chainId}`,
    disableSignup: input.disableSignup ?? true,
  });
  const signature = await input.provider.request({
    method: "personal_sign",
    params: [bytesToHex(new TextEncoder().encode(message)), address],
  });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error("The connected wallet returned an invalid signature");
  }

  if (input.requestAccountSelection) {
    const current = await input.provider.request({ method: "eth_accounts" });
    if (!Array.isArray(current) || typeof current[0] !== "string" || current[0].toLowerCase() !== address.toLowerCase()) {
      throw new WalletAccountSelectionError("Your wallet account changed. Choose the wallet again.");
    }
  }

  await input.loginWithSiwe({
    signature,
    message,
    disableSignup: input.disableSignup ?? true,
    walletClientType: input.provider.isMetaMask ? "metamask" : undefined,
    connectorType: "injected",
  });
  return true;
}
