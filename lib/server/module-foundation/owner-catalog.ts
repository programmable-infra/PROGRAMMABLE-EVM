import { verifyFoundationOwnerRuntimeV1 } from "@/lib/module-foundation/owner-runtime";
import { verifyFoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-verification";
import "server-only";
import publishers from "@/config/module-foundation/owner-publishers.json";
import { get } from "@vercel/blob";
import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { foundationBindingChainId, type FoundationChainId } from "@/lib/module-foundation/chains";
import { createFoundationServerClient } from "./client";
import { robinhoodChain, ROBINHOOD_MAINNET_RPC_URL } from "@/lib/chains";
import type { FoundationAvailabilityEnvelope } from "@/lib/module-foundation/availability";
import { FOUNDATION_OWNER_CATALOG_PATH, FOUNDATION_OWNER_CATALOG_V1, foundationOwnerReferenceV1,
 } from "@/lib/module-foundation/owner-publication";

// Share concurrent requests only. A later request always reads the current catalog/runtime.
const pendingReads = new Map<string, Promise<unknown[]>>();
const sharedClients = new Map<FoundationChainId, PublicClient>();
async function readCurrentCatalog(token: string): Promise<unknown[]> {
  const existing = pendingReads.get(token);
  if (existing) return existing;
  const pending = readFoundationOwnerCatalogV1(token);
  pendingReads.set(token, pending);
  try { return await pending; } finally { if (pendingReads.get(token) === pending) pendingReads.delete(token); }
}

function ownerClient(): PublicClient {
  return createPublicClient({ chain: robinhoodChain, transport: fallback([
    http(ROBINHOOD_MAINNET_RPC_URL, { timeout: 15_000, retryCount: 0 }),
    http("https://rpc-robinhood.blockmachine.io", { timeout: 15_000, retryCount: 0 }),
  ], { retryCount: 0, rank: false }) });
}

export async function readFoundationOwnerCatalogV1(token: string): Promise<unknown[]> {
  const result = await get(FOUNDATION_OWNER_CATALOG_PATH, { token, access: "private", useCache: false });
  if (!result) return [];
  if (result.statusCode !== 200 || !result.stream) throw new Error("Owner catalogue read failed.");
  const reader = result.stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > 16 * 1024 * 1024) throw new Error("Owner catalogue is too large."); chunks.push(value); }
  } finally { await reader.cancel().catch(() => undefined); }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (value.schemaVersion !== FOUNDATION_OWNER_CATALOG_V1 || !Array.isArray(value.publications) || value.publications.length > 256) throw new Error("Owner catalogue format differs.");
  return value.publications;
}
/** Read-only owner feed. Publication never requires a website wallet session or contributor review job. */
export async function withFoundationOwnerCatalogV1(availability: FoundationAvailabilityEnvelope,
  dependencies: { read?: () => Promise<unknown[]>; client?: PublicClient } = {}): Promise<FoundationAvailabilityEnvelope> {
  if (!availability.available || !availability.binding) return availability;
  const token = process.env.OPS_BLOB_READ_WRITE_TOKEN?.trim();
  if (!dependencies.read && !token) return availability;
  let values: unknown[];
  try { values = await (dependencies.read?.() ?? readCurrentCatalog(token!)); } catch { return availability; }
  if (!values.length) return availability;
  const chainId = foundationBindingChainId(availability.binding);
  let client = dependencies.client ?? sharedClients.get(chainId);
  if (!client) { client = chainId === 4663 ? ownerClient() : createFoundationServerClient(chainId); sharedClients.set(chainId, client); }
  const verified: Awaited<ReturnType<typeof verifyFoundationOwnerPublicationV1>>[] = [];
  // Bound provider concurrency as the catalog grows, while preserving catalog order.
  for (let offset = 0; offset < values.length; offset += 4) {
    const batch = await Promise.allSettled(values.slice(offset, offset + 4).map(async value => {
      const publication = await verifyFoundationOwnerPublicationV1(value, publishers.wallets);
      if (publication.release.chainId !== chainId || publication.protocolReleaseDigest !== availability.binding!.releaseDigest) return null;
      await verifyFoundationOwnerRuntimeV1(publication, client);
      return publication;
    }));
    for (const result of batch) if (result.status === "fulfilled" && result.value) verified.push(result.value);
  }
  const entries = [...availability.catalog.document.entries], admissions = [...availability.catalog.authority.admissions], releases = [...availability.catalog.authority.releases];
  const ids = new Set<string>(), families = new Set<string>();
  // New-launch screens show the newest source in each family. Token-specific
  // recovery retains older immutable packages to restore existing coins.
  verified.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  for (const p of verified) {
    if (!availability.token && families.has(p.manifest.familyId)) continue;
    families.add(p.manifest.familyId);
    if (ids.has(p.manifest.packageId)) continue;
    ids.add(p.manifest.packageId);
    const reference = foundationOwnerReferenceV1(p), entry = { manifest: p.manifest, review: reference, release: p.release };
    const index = entries.findIndex(e => e.manifest.packageId === p.manifest.packageId);
    if (index < 0) entries.push(entry); else entries[index] = entry;
    admissions.push(reference); releases.push(p.release);
  }
  return { ...availability, catalog: { document: { ...availability.catalog.document, entries }, authority: { admissions, releases } } };
}
