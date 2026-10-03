import { isAddress } from "viem";
import { readEthereumTokenPresentation } from "@/lib/server/ethereum-explore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const token = query.get("token");
  if (!token || !isAddress(token) || [...query.keys()].some(key => key !== "token") || query.getAll("token").length !== 1) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const result = await readEthereumTokenPresentation(token);
  return Response.json({ items: result.presentation ? [result.presentation] : [], status: result.status }, {
    status: result.status === "unavailable" ? 503 : 200,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
