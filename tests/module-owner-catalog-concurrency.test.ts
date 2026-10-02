import { expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import type { FoundationAvailabilityEnvelope } from "@/lib/module-foundation/availability";

const calls = vi.hoisted(() => ({ active: 0, maximum: 0, order: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/module-foundation/owner-verification", () => ({ verifyFoundationOwnerPublicationV1: async (value: unknown) => {
  const p = value as { invalid?: boolean };
  if (p.invalid) throw Error("invalid signature");
  return p;
} }));
vi.mock("@/lib/module-foundation/owner-runtime", () => ({ verifyFoundationOwnerRuntimeV1: async (p: { manifest: { packageId: string } }) => {
  calls.active++; calls.maximum = Math.max(calls.maximum, calls.active);
  await new Promise(resolve => setTimeout(resolve, 1));
  calls.order.push(p.manifest.packageId); calls.active--;
} }));
vi.mock("@/lib/module-foundation/owner-publication", () => ({ foundationOwnerReferenceV1: (p: { manifest: { packageId: string } }) => ({ packageId: p.manifest.packageId }) }));
import { withFoundationOwnerCatalogV1 } from "@/lib/server/module-foundation/owner-catalog";

it("checks independent modules in bounded parallel batches, preserves order and excludes invalid or other-host records", async () => {
  const availability = { available: true, binding: { releaseDigest: "host" }, catalog: { document: { entries: [] }, authority: { admissions: [], releases: [] } } } as unknown as FoundationAvailabilityEnvelope;
  const valid = Array.from({ length: 8 }, (_, i) => ({ protocolReleaseDigest: "host", manifest: { packageId: `module-${i}` }, release: {} }));
  const result = await withFoundationOwnerCatalogV1(availability, { read: async () => [
    ...valid, { ...valid[0], invalid: true }, { ...valid[0], protocolReleaseDigest: "other-host" }, valid[0],
  ], client: {} as PublicClient });
  expect(calls.maximum).toBe(4);
  expect(result.catalog.document.entries.map(e => e.manifest.packageId)).toEqual(valid.map(p => p.manifest.packageId));
  expect(result.catalog.authority.admissions).toHaveLength(8);
});
