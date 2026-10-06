import type { FoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-publication";

export async function readEthereumAuthority() {
  const response = await fetch("https://api.programmable.market/v1/module-foundation/ethereum/authority",
    { cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw Error("The live Ethereum authority could not be read."); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 131_072) throw Error("The Ethereum authority response exceeds its bounds.");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}

/** Public installation readback is checked in addition to deployment/runtime evidence. */
export function assertEthereumAuthority(publication: FoundationOwnerPublicationV1, value: unknown) {
  const authority = value as { schemaVersion?: unknown; chainId?: unknown; enabled?: unknown; releaseDigest?: unknown; modules?: unknown } | null;
  if (!authority || authority.schemaVersion !== "programmable.ethereum-module-authority.v1" || authority.chainId !== 1
    || authority.enabled !== true || authority.releaseDigest !== publication.protocolReleaseDigest
    || !Array.isArray(authority.modules) || authority.modules.length > 128
    || !authority.modules.some(module => module && typeof module.factory === "string"
      && module.factory.toLowerCase() === publication.release.factory.toLowerCase()
      && module.factoryCodeHash === publication.release.factoryCodeHash && module.moduleCodeHash === publication.release.moduleCodeHash
      && module.descriptorHash === publication.release.descriptorHash)) {
    throw Error("The live Ethereum authority has not admitted this exact module.");
  }
}
