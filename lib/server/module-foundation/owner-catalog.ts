import { verifyFoundationOwnerRuntimeV1 } from "@/lib/module-foundation/owner-runtime";
import { verifyFoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-verification";
import "server-only";
import publishers from "@/config/module-foundation/owner-publishers.json";
import { get } from "@vercel/blob";
import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { robinhoodChain, ROBINHOOD_MAINNET_RPC_URL } from "@/lib/chains";
import type { FoundationAvailabilityEnvelope } from "@/lib/module-foundation/availability";
import { FOUNDATION_OWNER_CATALOG_PATH, FOUNDATION_OWNER_CATALOG_V1, foundationOwnerReferenceV1,
 } from "@/lib/module-foundation/owner-publication";

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
  try { values = await (dependencies.read?.() ?? readFoundationOwnerCatalogV1(token!)); } catch { return availability; }
  const entries = [...availability.catalog.document.entries], admissions = [...availability.catalog.authority.admissions], releases = [...availability.catalog.authority.releases];
  const ids = new Set<string>();
  for (const value of values) {
    try {
      const p = await verifyFoundationOwnerPublicationV1(value, publishers.wallets);
      if (p.protocolReleaseDigest !== availability.binding.releaseDigest || ids.has(p.manifest.packageId)) continue;
      await verifyFoundationOwnerRuntimeV1(p, dependencies.client ?? ownerClient());
      ids.add(p.manifest.packageId);
      const reference = foundationOwnerReferenceV1(p), entry = { manifest: p.manifest, review: reference, release: p.release };
      const index = entries.findIndex(e => e.manifest.packageId === p.manifest.packageId);
      if (index < 0) entries.push(entry); else entries[index] = entry;
      admissions.push(reference); releases.push(p.release);
    } catch { /* An invalid owner publication cannot change the active modules. */ }
  }
  return { ...availability, catalog: { document: { ...availability.catalog.document, entries }, authority: { admissions, releases } } };
}
