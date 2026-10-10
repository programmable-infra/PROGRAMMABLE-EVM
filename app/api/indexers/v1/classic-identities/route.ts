import { readClassicLaunchCatalogV1 } from "@/lib/market-data/classic-launch-catalog.server";
import { classicPublicSnapshot } from "@/lib/market-data/classic-public-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type, If-None-Match",
  "Access-Control-Expose-Headers": "ETag, Retry-After, X-Programmable-Status",
  "X-Content-Type-Options": "nosniff",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers });
}

export async function GET() {
  try {
    const snapshot = classicPublicSnapshot(await readClassicLaunchCatalogV1());
    const body = JSON.stringify(snapshot);
    if (snapshot.entries.length > 10_000 || Buffer.byteLength(body) > 16 * 1024 * 1024) {
      throw new Error("Classic snapshot exceeds response bounds");
    }
    return new Response(body, { headers: { ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": snapshot.status === "current" ? "public, max-age=0, s-maxage=15" : "no-store",
      "X-Programmable-Status": snapshot.status,
    } });
  } catch {
    return Response.json({ status: "unavailable", error: "Classic launch identities are temporarily unavailable" },
      { status: 503, headers: { ...headers, "Cache-Control": "no-store", "Retry-After": "5" } });
  }
}
