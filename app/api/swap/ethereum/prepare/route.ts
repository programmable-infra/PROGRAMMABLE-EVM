import { EthereumStampedSwapError, parseEthereumStampedSwapRequest } from "@/lib/swap/ethereum-stamped";
import { prepareEthereumStampedSwap } from "@/lib/server/swap/ethereum-stamped";
import { LaunchPlanTradeErrorV1 } from "@/lib/custom-launch/routed-trade-plan-v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 4096) return json({ error: "The swap request is too large." }, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Send a valid swap request." }, 400);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return json({ error: "The swap request is too large." }, 413); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    body = parseEthereumStampedSwapRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return json({ error: "Send a valid Ethereum swap request." }, 400); }
  try { return json(await prepareEthereumStampedSwap(body)); }
  catch (error) {
    if (error instanceof EthereumStampedSwapError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof LaunchPlanTradeErrorV1) return json({ error: "This swap could not be checked. Please try again.", code: error.code }, 409);
    return json({ error: "This swap could not be checked. Please try again.", code: "ETHEREUM_SWAP_UNAVAILABLE" }, 502);
  }
}
