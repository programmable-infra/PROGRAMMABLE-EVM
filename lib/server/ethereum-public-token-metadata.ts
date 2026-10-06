import "server-only";

import { createPublicClient, http, parseAbi, type Address } from "viem";
import { mainnet } from "viem/chains";
import { characterLength, hasUnsafeDisplayCharacters, isValidTokenSymbol, MAX_TOKEN_DESCRIPTION_BYTES,
  MAX_TOKEN_NAME_BYTES, MAX_TOKEN_NAME_CHARACTERS, MAX_TOKEN_SYMBOL_BYTES, utf8ByteLength } from "@/lib/metadata-policy";
import { buildTokenLinks, sanitizeImageUrl, sanitizeSocialUrl, sanitizeWebsiteUrl } from "@/lib/onchain/metadata";
import { productionMainnetRpcPair, productionMainnetRpcPrimary } from "@/lib/onchain/website-rpc-providers.server";
import { isLaunchStampProvenanceV1, type CanonicalTokenExploreEntry, type TokenLink } from "@/lib/tokens";
import { parseStrictJson } from "./projection-target/canonical-json";
import { readBoundedUtf8BodyV1 } from "./custom-launch/bounded-utf8-body-v1";

const ABI = parseAbi([
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function metadata() view returns (string description,string website,string image,bytes extraData)",
  "function tokenURI() view returns (string)",
]);
const FUNCTIONS = ["name", "symbol", "metadata", "tokenURI"] as const;
const MAX_JSON_BYTES = 16_384;
export const ETHEREUM_METADATA_TTL_MS = 60_000;
export const ETHEREUM_METADATA_RECOVERY_MS = 300_000;
export const ETHEREUM_METADATA_BATCH_SIZE = 50;
export const ETHEREUM_METADATA_CACHE_SIZE = 512;

export type EthereumMetadataBoundary = Readonly<{ asOfBlock: string; asOfBlockHash: string }>;
export type EthereumPublicTokenMetadata = Readonly<{
  name?: string; symbol?: string; description?: string | null; imageUrl?: string | null; links?: readonly TokenLink[];
}>;
type ReadResult = Readonly<{ status: "success"; result: unknown }> | Readonly<{ status: "failure" }>;
type BatchReader = (addresses: readonly Address[], boundary: EthereumMetadataBoundary) => Promise<readonly ReadResult[]>;

function text(value: unknown, maximumBytes: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.normalize("NFC").trim();
  return utf8ByteLength(normalized) <= maximumBytes && !hasUnsafeDisplayCharacters(normalized) ? normalized : undefined;
}

/** Inline JSON is data, never executable content or a URL to fetch on the server. */
export function parseEthereumTokenUri(uri: unknown): EthereumPublicTokenMetadata | null {
  if (typeof uri !== "string" || uri.length > MAX_JSON_BYTES * 3 + 64) return null;
  const match = /^data:application\/json(?:;charset=utf-8|;utf8)?(;base64)?,([\s\S]*)$/iu.exec(uri);
  if (!match) return null;
  try {
    let source: string;
    if (match[1]) {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(match[2]!)) return null;
      source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(match[2]!, "base64"));
    } else {
      // ERC-1046 implementations also return literal JSON after ;utf8, with
      // percent signs inside links. Decode percent-encoded JSON only when needed.
      source = match[2]!.trimStart().startsWith("{") ? match[2]! : decodeURIComponent(match[2]!);
    }
    const value = parseStrictJson(source, { maximumBytes: MAX_JSON_BYTES, maximumDepth: 8 });
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const description = text(value.description, MAX_TOKEN_DESCRIPTION_BYTES);
    const image = value.image ?? value.image_url;
    const imageUrl = sanitizeImageUrl(image);
    const links: TokenLink[] = [];
    const website = sanitizeWebsiteUrl(value.website ?? value.external_url);
    if (website) links.push({ kind: "website", url: website });
    for (const [kind, candidate] of [["x", value.x ?? value.twitter], ["telegram", value.telegram],
      ["discord", value.discord], ["github", value.github], ["gitbook", value.gitbook]] as const) {
      const url = sanitizeSocialUrl(kind, candidate);
      if (url && !links.some(link => link.url === url)) links.push({ kind, url });
    }
    // JSON name/symbol are not authoritative: use the token getters below.
    return { ...(description !== undefined ? { description: description || null } : {}),
      ...(image !== undefined ? { imageUrl } : {}),
      ...(["website", "external_url", "x", "twitter", "telegram", "discord", "github", "gitbook"].some(field => field in value) ? { links } : {}) };
  } catch { return null; }
}

export function parseEthereumMetadataReads(reads: readonly ReadResult[]): EthereumPublicTokenMetadata | null {
  const result = (index: number) => reads[index]?.status === "success" ? (reads[index] as { result: unknown }).result : undefined;
  const name = text(result(0), MAX_TOKEN_NAME_BYTES);
  const symbol = text(result(1), MAX_TOKEN_SYMBOL_BYTES);
  const getter = result(2);
  let presentation: EthereumPublicTokenMetadata | null = null;
  if (Array.isArray(getter) && getter.length === 4 && getter.slice(0, 3).every(item => typeof item === "string")
    && typeof getter[3] === "string" && /^0x(?:[0-9a-f]{2}){0,1200}$/iu.test(getter[3])) {
    const description = text(getter[0], MAX_TOKEN_DESCRIPTION_BYTES);
    presentation = { ...(description !== undefined ? { description: description || null } : {}),
      imageUrl: sanitizeImageUrl(getter[2]), links: buildTokenLinks(getter[1], getter[3] as `0x${string}`) };
  } else presentation = parseEthereumTokenUri(result(3));
  const display = { ...presentation,
    ...(name && characterLength(name) <= MAX_TOKEN_NAME_CHARACTERS ? { name } : {}),
    ...(symbol && isValidTokenSymbol(symbol) ? { symbol } : {}) };
  return Object.keys(display).length ? display : null;
}

async function readMetadataBatchAt(url: string, addresses: readonly Address[], boundary: EthereumMetadataBoundary): Promise<readonly ReadResult[]> {
  const signal = AbortSignal.timeout(2_500);
  const client = createPublicClient({ chain: mainnet, transport: http(url, {
    retryCount: 0, timeout: 2_500,
    fetchFn: async (input, init) => {
      const response = await fetch(input, { ...init, cache: "no-store", redirect: "error", signal });
      if (!response.ok) { void response.body?.cancel(); throw new Error("Public token metadata unavailable"); }
      const body = await readBoundedUtf8BodyV1(response, 1_048_576, { signal });
      return new Response(body, { status: response.status, headers: { "Content-Type": "application/json" } });
    },
  }) });
  const blockNumber = BigInt(boundary.asOfBlock);
  // Two bounded reads for the whole batch, not four HTTP requests per token.
  const [block, results] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.multicall({ blockNumber, allowFailure: true, batchSize: 0,
      contracts: addresses.flatMap(address => FUNCTIONS.map(functionName => ({ address, abi: ABI, functionName }))) }),
  ]);
  if (block.hash?.toLowerCase() !== boundary.asOfBlockHash.toLowerCase()) throw new Error("Public token metadata block differs");
  return results.map(row => row.status === "success" ? { status: "success", result: row.result } : { status: "failure" });
}

/** Display-only fallback; both providers must match the saved canonical block. */
export function createProductionMetadataBatchReader(now = Date.now): BatchReader {
  let retryPrimaryAt = 0;
  return async (addresses, boundary) => {
    if (now() >= retryPrimaryAt) {
      try { return await readMetadataBatchAt(productionMainnetRpcPrimary().url, addresses, boundary); }
      catch { retryPrimaryAt = now() + 60_000; }
    }
    return readMetadataBatchAt(productionMainnetRpcPair().secondary.url, addresses, boundary);
  };
}

/** Display refreshes never alter the saved Router identity, stamp proof or admission. */
export function createEthereumPublicMetadataReader({ readBatch, now = Date.now }: {
  readBatch?: BatchReader; now?: () => number;
} = {}) {
  const read = readBatch ?? createProductionMetadataBatchReader(now);
  type Record = { boundary: EthereumMetadataBoundary; value: EthereumPublicTokenMetadata | null; observedAt: number; expiresAt: number };
  const cache = new Map<string, Record>();
  const pending = new Map<string, Promise<Record>>();
  const key = (entry: CanonicalTokenExploreEntry) => `${entry.tokenAddress.toLowerCase()}:${entry.launchStampProvenance!.stampHash.toLowerCase()}`;
  const compatible = (record: Record, boundary: EthereumMetadataBoundary) => BigInt(record.boundary.asOfBlock) <= BigInt(boundary.asOfBlock)
    && (record.boundary.asOfBlock !== boundary.asOfBlock || record.boundary.asOfBlockHash.toLowerCase() === boundary.asOfBlockHash.toLowerCase());
  return async (entries: readonly CanonicalTokenExploreEntry[], boundary: EthereumMetadataBoundary) => {
    if (!/^[1-9][0-9]{0,19}$/u.test(boundary.asOfBlock) || !/^0x[0-9a-f]{64}$/iu.test(boundary.asOfBlockHash)) return entries;
    const eligible = entries.filter(entry => isLaunchStampProvenanceV1(entry.launchStampProvenance, {
      tokenAddress: entry.tokenAddress, hookAddress: entry.hookAddress, poolId: entry.poolId,
      launchWallet: entry.creatorAddress, transactionHash: entry.launchTransactionHash,
      blockNumber: entry.launchBlockNumber, transactionIndex: entry.launchTransactionIndex, launchLogIndex: entry.launchLogIndex,
    })
      && entry.launchStampProvenance.chainId === 1 && entry.launchStampProvenance.kind === "custom-graph"
      && BigInt(entry.launchStampProvenance.blockNumber) <= BigInt(boundary.asOfBlock));
    const eligibleEntries = new Set(eligible);
    const missing = eligible.filter(entry => { const record = cache.get(key(entry)); return !record || record.expiresAt <= now() || !compatible(record, boundary); })
      .sort((a, b) => {
        const left = BigInt(a.launchBlockNumber ?? "0"), right = BigInt(b.launchBlockNumber ?? "0");
        return left === right ? 0 : left > right ? -1 : 1;
      });
    const selected = missing.filter(entry => !pending.has(key(entry))).slice(0, Math.min(ETHEREUM_METADATA_BATCH_SIZE, ETHEREUM_METADATA_CACHE_SIZE - pending.size));
    if (selected.length) {
      const operation = Promise.resolve().then(() => read(selected.map(entry => entry.tokenAddress as Address), boundary));
      selected.forEach((entry, index) => {
        const identity = key(entry);
        const read = operation.then(results => ({ boundary, value: parseEthereumMetadataReads(results.slice(index * 4, index * 4 + 4)),
          observedAt: now(), expiresAt: now() + ETHEREUM_METADATA_TTL_MS }), () => {
          const prior = cache.get(identity);
          // Keep a recent display through a short provider interruption. A
          // failed refresh cannot extend the age of that successful read.
          return prior?.value && compatible(prior, boundary) && now() - prior.observedAt <= ETHEREUM_METADATA_RECOVERY_MS
            ? { ...prior, expiresAt: now() + 15_000 }
            : { boundary, value: null, observedAt: now(), expiresAt: now() + 15_000 };
        })
          .then(record => {
            cache.delete(identity); cache.set(identity, record);
            while (cache.size > ETHEREUM_METADATA_CACHE_SIZE) cache.delete(cache.keys().next().value!);
            return record;
          }).finally(() => { if (pending.get(identity) === read) pending.delete(identity); });
        pending.set(identity, read);
      });
    }
    await Promise.all(eligible.flatMap(entry => { const read = pending.get(key(entry)); return read ? [read] : []; }));
    return entries.map((entry): CanonicalTokenExploreEntry => {
      if (!eligibleEntries.has(entry)) return entry;
      const record = cache.get(key(entry));
      if (!record?.value || now() - record.observedAt > ETHEREUM_METADATA_RECOVERY_MS || !compatible(record, boundary)) return entry;
      const { description: priorDescription, imageUrl: priorImage, links: priorLinks, ...identity } = entry;
      const description = record.value.description === undefined ? priorDescription : record.value.description;
      const imageUrl = record.value.imageUrl === undefined ? priorImage : record.value.imageUrl;
      const links = record.value.links === undefined ? priorLinks : record.value.links;
      return { ...identity, name: record.value.name ?? entry.name, symbol: record.value.symbol ?? entry.symbol,
        ...(description ? { description } : {}), ...(imageUrl ? { imageUrl } : {}),
        ...(links?.length ? { links: [...links] } : {}) };
    });
  };
}

export const readEthereumPublicTokenMetadata = createEthereumPublicMetadataReader();
