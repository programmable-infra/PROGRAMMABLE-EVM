import { NextResponse } from "next/server";
import { readOperationsHealth } from "@/lib/server/operations-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const health = await readOperationsHealth();
  return NextResponse.json(health, {
    status: health.status === "unavailable" ? 503 : 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Programmable-Indexing-Status": health.status,
    },
  });
}
