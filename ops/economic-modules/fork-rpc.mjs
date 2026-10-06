import { createServer } from "node:http";

const readMethods = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getProof", "eth_call",
  "net_version", "web3_clientVersion",
]);

// Anvil can fetch missing state, but cannot forward transactions to the real chain.
export function createReadOnlyRpc(upstream, { maximumRequests = 5000, fetchImpl = fetch } = {}) {
  let requests = 0;
  const counts = {};
  const denied = {};
  async function request(method, params = []) {
    if (!readMethods.has(method)) {
      denied[method] = (denied[method] ?? 0) + 1;
      throw Object.assign(new Error("Probe: upstream method denied"), { code: -32601 });
    }
    if (requests >= maximumRequests) throw new Error("Probe: upstream request budget exhausted");
    requests++;
    counts[method] = (counts[method] ?? 0) + 1;
    const response = await fetchImpl(upstream, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requests, method, params }),
      redirect: "error", signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("Probe: upstream RPC unavailable");
    const body = await response.json();
    if (body.error || !("result" in body)) throw new Error("Probe: upstream RPC rejected a read");
    return body.result;
  }
  async function listen() {
    const server = createServer(async (req, res) => {
      let message;
      try {
        if (req.method !== "POST") throw new Error("method");
        let bytes = 0; const chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 262144) throw new Error("size");
          chunks.push(chunk);
        }
        message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        // Reject batches outright so they cannot bypass method checks or accounting.
        if (Array.isArray(message) || !message || message.jsonrpc !== "2.0"
          || typeof message.method !== "string" || !Array.isArray(message.params ?? [])) throw new Error("shape");
        const result = await request(message.method, message.params);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      } catch (error) {
        const unsupported = error.code === -32601;
        res.writeHead(unsupported ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message?.id ?? null,
          error: { code: unsupported ? -32601 : -32000, message: "Read-only fork request failed" } }));
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
    });
    return { url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise(resolve => server.close(resolve)) };
  }
  return { request, listen, statistics: () => ({ requests, maximumRequests, methods: { ...counts }, denied: { ...denied } }) };
}
