import { isAddress } from "viem";
import { readEthereumProfileModules } from "@/lib/server/module-foundation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const account = query.get("account"), page = query.get("page") ?? "1";
  if (!account || !isAddress(account) || !/^[1-9]\d{0,5}$/.test(page)
    || [...query.keys()].some(key => !["account", "page"].includes(key) || query.getAll(key).length !== 1)) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const result = await readEthereumProfileModules(account, Number(page));
  return Response.json(result, { status: result.status === "unavailable" ? 503 : 200, headers: {
    "cache-control": result.status === "unavailable" ? "no-store" : "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
    "x-content-type-options": "nosniff",
  } });
}
