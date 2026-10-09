import {
  CLASSIC_LAUNCHERS,
  CLAIMS,
  CUSTOM_EVENT_TOPICS,
  CUSTOM_REGISTRY,
  CUSTOM_V2_POLICY,
  CUSTOM_V2_RELEASE_PATH,
  CUSTOM_V2_SELECTORS,
  HOOKS,
  LAUNCH_STAMP_ROUTER,
  LAUNCH_STAMP_SELECTORS,
  LAUNCH_STAMP_TOPICS,
  MAINNET_CHAIN_ID,
  ROUTER_CUSTOM_CLAIM_PROFILES,
  SELECTORS,
  TREASURY,
  atomicCapabilityStatus,
  buildWalletSendCalls,
  confirmedBatchReceiptProof,
  confirmedTransactionReceiptMatches,
  createLatestOperationGuard,
  createRefreshQueue,
  customClaimDefinitionClassification,
  customLaunchClassification,
  customLaunchStateData,
  customV2Bytes32ReadData,
  customV2IndexedReadData,
  customV2SourceClassification,
  decodeAddress,
  decodeBool,
  decodeBytes4,
  decodeBytes32,
  decodeCustomLaunchState,
  decodeCustomV2SourceState,
  decodeLaunchStampProof,
  decodeLaunchStampRecord,
  decodeUint256,
  encodeAddressArgument,
  exactRouterFinalizedCheckpoint,
  formatEth,
  formatUnits,
  isTreasury,
  keccak256Hex,
  launchStampAddressReadData,
  launchStampBytes32ReadData,
  launchStampLogSetFingerprint,
  launchStampPoolReadData,
  normalizeBatchId,
  metaMaskProviderFrom,
  parseCustomV2Release,
  poolManagerBalanceOfData,
  readAccruedData,
  reduceClassicLaunchLogs,
  reduceCustomRegistryLogs,
  reduceLaunchStampLogs,
  requireAtomicClaimCapability,
  routerFinalizedBoundary,
  shortAddress,
  toQuantityHex,
  routerCustomClaimClassification,
  routerClaimCoverage,
  validatedAtomicBatchStatus,
  walletSendDefinitelyNotSubmitted,
  walletSendDuplicateBatchId,
  withTimeout,
} from "./logic.mjs";
import {
  SCAN_SNAPSHOT_STORAGE_KEY,
  createScanSnapshot,
  parseScanSnapshot,
} from "./view-state.mjs";

const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");
const EVENT_LOG_CHUNK_SIZE = 10_000n;
const MAX_ROUTER_LAUNCHES = 4_096;
const MAX_BATCH_CALLS = 64;
const ROUTER_QUORUM_RPC_GROUPS = Object.freeze([
  Object.freeze([
    "https://mainnet.gateway.tenderly.co",
    "https://eth.drpc.org",
  ]),
  Object.freeze(["https://rpc.mevblocker.io"]),
]);
const ROUTER_QUORUM_TIMEOUT_MS = 20_000;
const WALLET_DISCOVERY_TIMEOUT_MS = 1_500;
const AUTO_REFRESH_AFTER_MS = 60_000;
const CONFIRMED_BATCH_STORAGE_KEY =
  "programmable.fee-claim.confirmed-batch.v2";
const CONFIRMED_BATCH_SCHEMA = "programmable.confirmed-claim-batch.v2";
const CLAIM_SUBMISSION_LEASE = "programmable-fee-claim-submission";
const INTERACTIVE_WALLET_METHODS = new Set([
  "eth_requestAccounts",
  "wallet_requestPermissions",
  "wallet_switchEthereumChain",
  "wallet_sendCalls",
]);

const announcedWalletProviders = new Map();
let boundWalletProvider = null;
let walletAuthorizationRevision = 0;
const walletSyncGuard = createLatestOperationGuard();

function rememberAnnouncedWalletProvider(event) {
  const detail = event?.detail;
  if (
    typeof detail?.info?.uuid !== "string" ||
    typeof detail?.provider?.request !== "function"
  )
    return;
  announcedWalletProviders.set(detail.info.uuid, detail);
}

window.addEventListener(
  "eip6963:announceProvider",
  rememberAnnouncedWalletProvider,
);
window.dispatchEvent(new Event("eip6963:requestProvider"));

function invalidConfirmedBatchLock() {
  return {
    schema: CONFIRMED_BATCH_SCHEMA,
    account: TREASURY.toLowerCase(),
    chainId: MAINNET_CHAIN_ID,
    batchId: null,
    batch: null,
    phase: "manual",
    receipts: null,
    failureStatus: null,
    invalid: true,
  };
}

function normalizeStoredBatch(batch, expectedBatchId) {
  const id = normalizeBatchId(batch?.id);
  if (
    id.toLowerCase() !== expectedBatchId.toLowerCase() ||
    batch?.version !== "2.0.0" ||
    !isTreasury(batch?.from) ||
    batch?.chainId !== MAINNET_CHAIN_ID ||
    batch?.atomicRequired !== true ||
    !Array.isArray(batch?.calls) ||
    batch.calls.length === 0 ||
    batch.calls.length > MAX_BATCH_CALLS
  ) {
    throw new Error("Ungültiger gespeicherter Claim-Batch");
  }
  const calls = batch.calls.map((call) => {
    if (
      typeof call?.to !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(call.to) ||
      typeof call?.data !== "string" ||
      !/^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{64})*$/.test(call.data) ||
      call?.value !== "0x0"
    ) {
      throw new Error("Ungültiger gespeicherter Claim-Call");
    }
    return {
      to: call.to,
      data: call.data.toLowerCase(),
      value: "0x0",
    };
  });
  const callKeys = calls.map(
    ({ to, data }) => `${to.toLowerCase()}:${data}`,
  );
  if (new Set(callKeys).size !== callKeys.length)
    throw new Error("Doppelter gespeicherter Claim-Call");
  return {
    version: "2.0.0",
    id,
    from: batch.from,
    chainId: MAINNET_CHAIN_ID,
    atomicRequired: true,
    calls,
  };
}

function normalizeStoredReceipt(receipt) {
  const blockNumber = BigInt(receipt?.blockNumber);
  if (
    blockNumber <= 0n ||
    typeof receipt?.blockHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash) ||
    typeof receipt?.transactionHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(receipt.transactionHash)
  ) {
    throw new Error("Ungültiger gespeicherter Receipt");
  }
  return {
    blockNumber: blockNumber.toString(),
    blockHash: receipt.blockHash.toLowerCase(),
    transactionHash: receipt.transactionHash.toLowerCase(),
  };
}

function loadConfirmedBatchLock() {
  let stored;
  try {
    stored = window.localStorage.getItem(CONFIRMED_BATCH_STORAGE_KEY);
  } catch {
    return invalidConfirmedBatchLock();
  }
  if (stored === null) return null;

  try {
    const parsed = JSON.parse(stored);
    const batchId = normalizeBatchId(parsed.batchId);
    const batch = normalizeStoredBatch(parsed.batch, batchId);
    const receipts =
      parsed.receipts === null
        ? null
        : parsed.receipts.map(normalizeStoredReceipt);
    if (
      parsed.schema !== CONFIRMED_BATCH_SCHEMA ||
      !isTreasury(parsed.account) ||
      parsed.chainId !== MAINNET_CHAIN_ID ||
      batchId !== parsed.batchId ||
      !["submitting", "pending", "confirmed", "manual"].includes(
        parsed.phase,
      ) ||
      (parsed.phase === "confirmed" &&
        (!Array.isArray(receipts) || receipts.length === 0)) ||
      (parsed.failureStatus !== null &&
        !Number.isInteger(parsed.failureStatus))
    ) {
      throw new Error("Ungültige Claim-Sperre");
    }
    return {
      schema: CONFIRMED_BATCH_SCHEMA,
      account: parsed.account.toLowerCase(),
      chainId: MAINNET_CHAIN_ID,
      batchId,
      batch,
      phase: parsed.phase,
      receipts,
      failureStatus: parsed.failureStatus,
    };
  } catch {
    return invalidConfirmedBatchLock();
  }
}

function requireConfirmedBatchStorage() {
  const probeKey = `${CONFIRMED_BATCH_STORAGE_KEY}.probe`;
  try {
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
  } catch {
    throw new Error(
      "Der sichere Claim-Status kann in diesem Browser nicht gespeichert werden. Es wurde nichts gesendet.",
    );
  }
}

function loadScanSnapshot() {
  try {
    const stored = window.localStorage.getItem(SCAN_SNAPSHOT_STORAGE_KEY);
    if (stored === null) return null;
    return parseScanSnapshot(stored, {
      expectedAccount: TREASURY,
      expectedChainId: MAINNET_CHAIN_ID,
    });
  } catch {
    return null;
  }
}

const initialScanSnapshot = DEMO_MODE ? null : loadScanSnapshot();

const state = {
  account: null,
  chainId: null,
  blockTag: null,
  capability: null,
  capabilityStatus: "idle",
  walletMissing: false,
  confirmedBatch: DEMO_MODE ? null : loadConfirmedBatchLock(),
  scanSnapshot: initialScanSnapshot,
  scanInProgress: false,
  claims: new Map(),
  hooks: new Map(),
  custom: {
    status: "idle",
    registryVerified: false,
    launches: [],
    error: null,
  },
  customV2: {
    status: "idle",
    release: null,
    sources: [],
    error: null,
  },
  router: {
    status: "idle",
    verified: false,
    finalizedBlock: null,
    launches: [],
    error: null,
  },
  classic: {
    status: "idle",
    launchersVerified: false,
    launches: [],
    error: null,
  },
  busy: false,
};

function saveConfirmedBatchLock(
  lock,
  { expectedBatchId = null, requireEmpty = false } = {},
) {
  try {
    const stored = loadConfirmedBatchLock();
    if (
      stored?.invalid ||
      (requireEmpty && stored !== null) ||
      (expectedBatchId !== null &&
        stored?.batchId?.toLowerCase() !== expectedBatchId.toLowerCase())
    ) {
      state.confirmedBatch = stored;
      return false;
    }
    const serialized = JSON.stringify(lock);
    window.localStorage.setItem(CONFIRMED_BATCH_STORAGE_KEY, serialized);
    if (window.localStorage.getItem(CONFIRMED_BATCH_STORAGE_KEY) !== serialized)
      return false;
    state.confirmedBatch = lock;
    return true;
  } catch {
    return false;
  }
}

function clearConfirmedBatchLock(expectedBatchId) {
  try {
    const stored = loadConfirmedBatchLock();
    if (
      stored &&
      (!expectedBatchId ||
        stored.batchId?.toLowerCase() !== expectedBatchId.toLowerCase())
    ) {
      state.confirmedBatch = stored;
      return false;
    }
    window.localStorage.removeItem(CONFIRMED_BATCH_STORAGE_KEY);
    if (window.localStorage.getItem(CONFIRMED_BATCH_STORAGE_KEY) !== null)
      return false;
    state.confirmedBatch = null;
    return true;
  } catch {
    return false;
  }
}

function highestConfirmedReceiptBlock(lock = state.confirmedBatch) {
  if (!Array.isArray(lock?.receipts) || lock.receipts.length === 0) return null;
  return lock.receipts.reduce((highest, receipt) => {
    const blockNumber = BigInt(receipt.blockNumber);
    return blockNumber > highest ? blockNumber : highest;
  }, 0n);
}

function confirmedBatchStatus() {
  if (state.confirmedBatch?.invalid)
    return "Lokaler Claim-Status ist unvollständig · Claims bleiben gesperrt";
  if ((state.confirmedBatch?.failureStatus ?? 0) >= 600)
    return "Wallet meldet mögliche Teil-Ausführung · Claims bleiben gesperrt";
  if (state.confirmedBatch?.phase === "submitting")
    return "Wallet-Antwort wird wiederhergestellt · kein neuer Claim möglich";
  if (state.confirmedBatch?.phase !== "confirmed")
    return "MetaMask-Batch wird bestätigt · kein neuer Claim möglich";
  return `Claim bestätigt · wartet auf finalisierten Block ${highestConfirmedReceiptBlock()?.toString()}`;
}

function createAppBatchId() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function withExclusiveClaimLease(callback) {
  if (!window.navigator.locks?.request)
    throw new Error(
      "Dieser Browser kann parallele Claim-Tabs nicht sicher koordinieren. Es wurde nichts gesendet.",
    );
  return window.navigator.locks.request(
    CLAIM_SUBMISSION_LEASE,
    { mode: "exclusive", ifAvailable: true },
    async (lease) => {
      if (!lease)
        throw new Error(
          "Ein anderer Tab bereitet bereits einen Claim vor. Es wurde nichts gesendet.",
        );
      const stored = loadConfirmedBatchLock();
      if (stored) {
        state.confirmedBatch = stored;
        renderSummary();
        throw new Error(
          "Ein bestehender Claim-Batch muss zuerst finalisiert werden",
        );
      }
      return callback();
    },
  );
}

async function withExistingClaimLease(callback) {
  if (!window.navigator.locks?.request)
    throw new Error(
      "Dieser Browser kann parallele Claim-Tabs nicht sicher koordinieren. Es wurde nichts gesendet.",
    );
  return window.navigator.locks.request(
    CLAIM_SUBMISSION_LEASE,
    { mode: "exclusive", ifAvailable: true },
    async (lease) => {
      if (!lease)
        throw new Error(
          "Ein anderer Tab prüft bereits diesen Claim-Batch. Es wurde nichts erneut gesendet.",
        );
      const stored = loadConfirmedBatchLock();
      if (!stored || stored.invalid)
        throw new Error("Der gespeicherte Claim-Batch ist nicht wiederherstellbar");
      state.confirmedBatch = stored;
      return callback(stored);
    },
  );
}

async function withAvailableClaimStateLease(callback) {
  if (!window.navigator.locks?.request) return null;
  return window.navigator.locks.request(
    CLAIM_SUBMISSION_LEASE,
    { mode: "exclusive", ifAvailable: true },
    (lease) => (lease ? callback() : null),
  );
}

const elements = {
  action: document.querySelector("[data-action]"),
  actionLabel: document.querySelector("[data-action-label]"),
  actionDetail: document.querySelector("[data-action-detail]"),
  account: document.querySelector("[data-account]"),
  batchMode: document.querySelector("[data-batch-mode]"),
  claimCount: document.querySelector("[data-claim-count]"),
  claimRows: document.querySelector("[data-claim-rows]"),
  content: document.querySelector(".content"),
  error: document.querySelector("[data-error]"),
  errorDetail: document.querySelector("[data-error-detail]"),
  metamaskOpen: document.querySelector("[data-metamask-open]"),
  network: document.querySelector("[data-network]"),
  status: document.querySelector("[data-status]"),
  total: document.querySelector("[data-total]"),
  totalCard: document.querySelector("[data-total-card]"),
  totalLabel: document.querySelector("[data-total-label]"),
  walletState: document.querySelector("[data-wallet-state]"),
};

function clearWalletAuthorizationState() {
  state.account = null;
  state.chainId = null;
  state.capability = null;
  state.capabilityStatus = "idle";
}

function invalidateWalletAuthorizationState() {
  walletAuthorizationRevision += 1;
  walletSyncGuard.invalidate();
  clearWalletAuthorizationState();
  return walletAuthorizationRevision;
}

async function syncAfterWalletEvent() {
  const revision = invalidateWalletAuthorizationState();
  setError();
  setStatus("Wallet wird aktualisiert");
  renderSummary();
  try {
    await syncWallet({ expectedRevision: revision });
  } catch {
    if (revision !== walletAuthorizationRevision) return;
    clearWalletAuthorizationState();
    setError("Wallet-Status konnte nicht aktualisiert werden");
    setStatus("MetaMask erneut verbinden");
    renderSummary();
  }
}

function failClosedAfterWalletDisconnect() {
  invalidateWalletAuthorizationState();
  setError("MetaMask wurde getrennt");
  setStatus("MetaMask verbinden");
  renderSummary();
}

function bindWalletProviderEvents(walletProvider) {
  if (boundWalletProvider === walletProvider) return;
  boundWalletProvider?.removeListener?.(
    "accountsChanged",
    syncAfterWalletEvent,
  );
  boundWalletProvider?.removeListener?.("chainChanged", syncAfterWalletEvent);
  boundWalletProvider?.removeListener?.(
    "disconnect",
    failClosedAfterWalletDisconnect,
  );
  boundWalletProvider = walletProvider;
  boundWalletProvider.on?.("accountsChanged", syncAfterWalletEvent);
  boundWalletProvider.on?.("chainChanged", syncAfterWalletEvent);
  boundWalletProvider.on?.("disconnect", failClosedAfterWalletDisconnect);
}

function selectedMetaMaskProvider({ allowLegacy = false } = {}) {
  const selected = metaMaskProviderFrom(
    [...announcedWalletProviders.values()],
    allowLegacy ? window.ethereum : null,
  );
  if (!selected) return null;
  bindWalletProviderEvents(selected);
  return selected;
}

async function requireMetaMaskProvider() {
  let selected = selectedMetaMaskProvider();
  if (selected) {
    state.walletMissing = false;
    return selected;
  }
  if (boundWalletProvider) {
    state.walletMissing = false;
    return boundWalletProvider;
  }

  window.dispatchEvent(new Event("eip6963:requestProvider"));
  selected = selectedMetaMaskProvider();
  if (selected) {
    state.walletMissing = false;
    return selected;
  }

  await new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("eip6963:announceProvider", finish);
      window.removeEventListener("ethereum#initialized", retry);
    };
    const settle = () => {
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      resolve();
    };
    const finish = () => {
      if (settled || !selectedMetaMaskProvider()) return;
      settle();
    };
    const retry = () => {
      if (settled) return;
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      finish();
    };
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, WALLET_DISCOVERY_TIMEOUT_MS);
    window.addEventListener("eip6963:announceProvider", finish);
    window.addEventListener("ethereum#initialized", retry);
  });

  selected = selectedMetaMaskProvider({ allowLegacy: true });
  if (!selected) {
    state.walletMissing = true;
    const error = new Error(
      "MetaMask wurde nicht gefunden. Erweiterung entsperren, Seite neu laden und erneut verbinden.",
    );
    error.code = "METAMASK_NOT_FOUND";
    throw error;
  }
  state.walletMissing = false;
  return selected;
}

async function request(method, params = []) {
  const walletProvider = await requireMetaMaskProvider();
  const operation = walletProvider.request({ method, params });
  if (INTERACTIVE_WALLET_METHODS.has(method)) return operation;
  return withTimeout(
    operation,
    ROUTER_QUORUM_TIMEOUT_MS,
    `Wallet-RPC-Zeitlimit bei ${method} überschritten`,
  );
}

let publicRpcId = 1;

async function publicRpcRequest(url, method, params = []) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    ROUTER_QUORUM_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: publicRpcId++,
        method,
        params,
      }),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Router-Quorum-RPC antwortet mit HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.error || payload?.result === undefined)
      throw new Error(
        payload?.error?.message ?? "Router-Quorum-RPC-Antwort ist ungültig",
      );
    return payload.result;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function publicRpcGroupRequest(urls, method, params = []) {
  let lastError;
  for (const url of urls) {
    try {
      return await publicRpcRequest(url, method, params);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Router-Quorum-RPC-Gruppe ist nicht verfügbar");
}

async function routerQuorumRequest(method, params = []) {
  return Promise.all([
    request(method, params),
    ...ROUTER_QUORUM_RPC_GROUPS.map((urls) =>
      publicRpcGroupRequest(urls, method, params),
    ),
  ]);
}

function setError(message = "") {
  elements.error.textContent = message;
  elements.error.hidden = message.length === 0;
}

function setDetailedError(message = "") {
  elements.errorDetail.textContent = message;
  elements.errorDetail.hidden = message.length === 0;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function disclosureIndicator() {
  const indicator = document.createElement("span");
  indicator.className = "disclosure-indicator";
  indicator.setAttribute("aria-hidden", "true");
  return indicator;
}

function hookVerified(claim) {
  if (claim.kind === "custom") {
    if (claim.origin === "launch-stamp-router")
      return (
        claim.provenanceVerified === true &&
        claim.runtimeVerified === true &&
        claim.claimBindingVerified === true
      );
    return claim.bindingVerified === true;
  }
  return state.hooks.get(claim.hookId)?.verified === true;
}

function claimHasOpenAmount(claim) {
  return (
    (typeof claim?.amount === "bigint" && claim.amount > 0n) ||
    (typeof claim?.secondaryAmount === "bigint" &&
      claim.secondaryAmount > 0n)
  );
}

function statusLabel(claim) {
  if (claim.status === "disconnected") return "Nach Verbindung";
  if (claim.status === "loading") return "Wird gelesen";
  if (claim.status === "claiming") return "In MetaMask bestätigen";
  if (claim.status === "pending") return "Wird bestätigt";
  if (claim.status === "claimed") return "Geclaimt";
  if (claim.status === "failed") return "Nicht verfügbar";
  if (state.confirmedBatch && claimHasOpenAmount(claim))
    return "Bestätigt · Finalität ausstehend";
  if (!hookVerified(claim)) return "Contract nicht verifiziert";
  if (!claim.recipientMatches) return "Falscher Empfänger";
  if (!claimHasOpenAmount(claim)) return "Nichts offen";
  return "Bereit";
}

function buildRow(claim) {
  const row = document.createElement("li");
  row.className = "claim-row";
  row.dataset.state = claim.status;

  const identity = document.createElement("div");
  identity.className = "claim-identity";
  const name = document.createElement("strong");
  name.textContent = claim.name;
  const detail = document.createElement("span");
  detail.textContent = `${claim.detail} · ${shortAddress(claim.address)}`;
  identity.append(name, detail);

  const value = document.createElement("div");
  value.className = "claim-value";
  const amount = document.createElement("strong");
  amount.textContent = `${formatUnits(claim.amount, claim.decimals)} ${claim.unit}`;
  const status = document.createElement("span");
  status.textContent = statusLabel(claim);
  value.append(amount, status);
  row.append(identity, value);
  return row;
}

function customStatusLabel(launch) {
  const classification = customLaunchClassification(launch);
  if (launch.status === "claiming") return "In MetaMask bestätigen";
  if (launch.status === "pending") return "Wird bestätigt";
  if (launch.status === "claimed") return "Geclaimt";
  if (launch.status === "failed") return "Nicht verfügbar";
  if (state.confirmedBatch && classification === "ready")
    return "Bestätigt · Finalität ausstehend";
  if (classification === "ready") return "Bereit";
  if (classification === "empty") return "Nichts offen";
  if (classification === "no-market") return "Kein Fee-Markt";
  if (classification === "pending") return "Noch nicht finalisiert";
  if (classification === "revoked") return "Widerrufen";
  if (classification === "adapter-required")
    return "Claim-Adapter noch nicht live";
  return "Onchain-Bindung unvollständig";
}

function buildCustomRow(launch) {
  const current = state.claims.get(launch.id) ?? launch;
  const rendered = { ...launch, ...current };
  const row = document.createElement("li");
  row.className = "claim-row custom-row";
  row.dataset.state = ["claiming", "pending", "claimed", "failed"].includes(
    rendered.status,
  )
    ? rendered.status
    : customLaunchClassification(rendered);

  const identity = document.createElement("div");
  identity.className = "claim-identity";
  const name = document.createElement("strong");
  name.textContent = `Custom Launch ${launch.registrationSequence.toString()}`;
  const detail = document.createElement("span");
  detail.textContent = `${shortAddress(launch.launchId)} · ${shortAddress(launch.primaryContract)}`;
  identity.append(name, detail);

  const value = document.createElement("div");
  value.className = "claim-value";
  const fee = document.createElement("strong");
  fee.textContent =
    launch.standardClaimBindingVerified === true
      ? `${formatEth(rendered.amount)} ETH`
      : `${launch.feePolicy?.programmableShareBps ?? 0} bps`;
  const status = document.createElement("span");
  status.textContent = customStatusLabel(rendered);
  value.append(fee, status);
  row.append(identity, value);
  return row;
}

function customV2StatusLabel(source) {
  if (source.status === "claiming") return "In MetaMask bestätigen";
  if (source.status === "pending") return "Wird bestätigt";
  if (source.status === "claimed") return "Geclaimt";
  if (source.status === "failed") return "Nicht verfügbar";
  const classification = customV2SourceClassification(source);
  if (state.confirmedBatch && classification === "ready")
    return "Bestätigt · Finalität ausstehend";
  if (classification === "ready") return "Bereit";
  if (classification === "empty") return "Nichts offen";
  if (classification === "quarantined") return "Nicht ausführbar";
  return "Onchain-Bindung unvollständig";
}

function buildCustomV2Row(source) {
  const current = state.claims.get(source.id) ?? source;
  const rendered = { ...source, ...current };
  const row = document.createElement("li");
  row.className = "claim-row custom-row";
  row.dataset.state =
    ["claiming", "pending", "claimed", "failed"].includes(rendered.status)
      ? rendered.status
      : customV2SourceClassification(rendered);

  const identity = document.createElement("div");
  identity.className = "claim-identity";
  const name = document.createElement("strong");
  name.textContent = `Custom Launch ${source.index + 1}`;
  const detail = document.createElement("span");
  detail.textContent = `${shortAddress(source.launchId)} · ${shortAddress(source.address)}`;
  identity.append(name, detail);

  const value = document.createElement("div");
  value.className = "claim-value";
  const amount = document.createElement("strong");
  amount.textContent = `${formatEth(rendered.amount)} ETH`;
  const status = document.createElement("span");
  status.textContent = customV2StatusLabel(rendered);
  value.append(amount, status);
  row.append(identity, value);
  return row;
}

function routerCustomStatusLabel(source) {
  const current = state.claims.get(source.id) ?? source;
  if (current.status === "claiming") return "In MetaMask bestätigen";
  if (current.status === "pending") return "Wird bestätigt";
  if (current.status === "claimed") return "Geclaimt";
  const classification = routerCustomClaimClassification({
    ...source,
    ...current,
  });
  if (state.confirmedBatch && classification === "ready")
    return "Bestätigt · Finalität ausstehend";
  if (classification === "ready") return "Bereit";
  if (classification === "empty") return "Nichts offen";
  if (classification === "no-manual-claim")
    return "Gebühren werden direkt ausgezahlt";
  return "Claim-Profil fehlt · alles gesperrt";
}

function buildRouterCustomRow(source) {
  const current = state.claims.get(source.id) ?? source;
  const rendered = { ...source, ...current };
  const classification = routerCustomClaimClassification(rendered);
  const row = document.createElement("li");
  row.className = "claim-row custom-row router-custom-row";
  row.dataset.state = ["claiming", "pending", "claimed"].includes(
    rendered.status,
  )
    ? rendered.status
    : classification;

  const identity = document.createElement("div");
  identity.className = "claim-identity";
  const name = document.createElement("strong");
  name.textContent = `Custom · ${shortAddress(source.token)}`;
  const detail = document.createElement("span");
  detail.textContent = `Launch Router · ${shortAddress(source.hook)}`;
  identity.append(name, detail);

  const value = document.createElement("div");
  value.className = "claim-value";
  const amount = document.createElement("strong");
  if (classification === "no-manual-claim") {
    amount.textContent = "Direkt";
  } else if (classification === "blocked") {
    amount.textContent = "—";
  } else {
    const amounts = [];
    if ((rendered.amount ?? 0n) > 0n)
      amounts.push(`${formatEth(rendered.amount)} ETH`);
    if ((rendered.secondaryAmount ?? 0n) > 0n)
      amounts.push(
        `${formatUnits(rendered.secondaryAmount, rendered.secondaryDecimals)} ${rendered.secondaryUnit}`,
      );
    amount.textContent = amounts.length > 0 ? amounts.join(" + ") : "0 ETH";
  }
  const status = document.createElement("span");
  status.textContent = routerCustomStatusLabel(rendered);
  value.append(amount, status);
  row.append(identity, value);
  return row;
}

function buildCustomGroup() {
  const routerCustoms = state.router.launches.filter(
    ({ launchKind }) => launchKind === 1,
  );
  const group = document.createElement("li");
  group.className = "asset-group custom-group";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const identity = document.createElement("span");
  identity.className = "asset-group-identity";
  const name = document.createElement("strong");
  name.textContent = "Custom-v4-Gebühren";
  const detail = document.createElement("span");
  detail.textContent = "Retired V1 + offizieller Launch Router";
  identity.append(name, detail);

  const value = document.createElement("span");
  value.className = "asset-group-value";
  const count = document.createElement("strong");
  const hint = document.createElement("span");
  if (state.account === null) {
    count.textContent = "Registry";
    hint.textContent = "Nach Verbindung";
  } else if (
    state.custom.status === "loading" ||
    state.customV2.status === "loading" ||
    state.router.status === "loading"
  ) {
    count.textContent = "Wird gelesen";
    hint.textContent = "Finalisierte Launches";
  } else if (state.custom.error || state.router.error) {
    count.textContent = "Nicht verfügbar";
    hint.textContent = "Claims gesperrt";
  } else {
    const feeBearing = state.custom.launches.filter(
      (launch) => customLaunchClassification(launch) === "adapter-required",
    ).length;
    const readyV1Count = state.custom.launches.filter(
      (launch) => customLaunchClassification(launch) === "ready",
    ).length;
    const sourceCount = state.customV2.sources.length;
    const routerReadyCount = routerCustoms.filter(
      (source) => routerCustomClaimClassification(source) === "ready",
    ).length;
    const routerBlockedCount = routerCustoms.filter(
      (source) => routerCustomClaimClassification(source) === "blocked",
    ).length;
    const readyCount =
      readyV1Count +
      routerReadyCount +
      state.customV2.sources.filter(
        (source) => customV2SourceClassification(source) === "ready",
      ).length;
    count.textContent = `${state.custom.launches.length + sourceCount + routerCustoms.length} erkannt`;
    if (state.customV2.error) hint.textContent = "V2-Release gesperrt";
    else if (routerBlockedCount > 0)
      hint.textContent = `${routerBlockedCount} unbekanntes Claim-Profil gesperrt`;
    else if (readyCount > 0)
      hint.textContent = `${readyCount} Custom-Claim${readyCount === 1 ? "" : "s"} offen`;
    else if (feeBearing > 0)
      hint.textContent = `${feeBearing} Legacy-Quelle${feeBearing === 1 ? "" : "n"} gesperrt`;
    else if (state.customV2.status === "hold")
      hint.textContent = "V2 wartet auf Mainnet-Release";
    else hint.textContent = "Keine Custom-Fees offen";
  }
  value.append(count, hint);
  summary.append(identity, value, disclosureIndicator());
  details.append(summary);

  if (
    state.custom.launches.length > 0 ||
    state.customV2.sources.length > 0 ||
    routerCustoms.length > 0
  ) {
    const list = document.createElement("ul");
    list.className = "asset-list";
    list.replaceChildren(
      ...state.customV2.sources.map(buildCustomV2Row),
      ...routerCustoms.map(buildRouterCustomRow),
      ...state.custom.launches.map(buildCustomRow),
    );
    details.append(list);
  }
  group.append(details);
  return group;
}

function buildClassicLaunchRow(launch) {
  const row = document.createElement("li");
  row.className = "claim-row classic-launch-row";
  const releaseName = launch.releaseName ?? "Launch Router";
  const covered = launch.claimMode !== "unsupported";
  row.dataset.state = covered ? "covered" : "blocked";

  const identity = document.createElement("div");
  identity.className = "claim-identity";
  const name = document.createElement("strong");
  name.textContent = launch.symbol || launch.name || "Classic Token";
  const detail = document.createElement("span");
  detail.textContent = `${releaseName} · ${shortAddress(launch.token)}`;
  identity.append(name, detail);

  const value = document.createElement("div");
  value.className = "claim-value";
  const coverage = document.createElement("strong");
  coverage.textContent = covered ? "Enthalten" : "Gesperrt";
  const status = document.createElement("span");
  status.textContent = covered
    ? `Im ${launch.claimProfile ?? releaseName}-Claim`
    : "Unbekannter Classic-Hook";
  value.append(coverage, status);
  row.append(identity, value);
  return row;
}

function buildClassicLaunchGroup() {
  const routerClassic = state.router.launches.filter(
    ({ launchKind }) => launchKind === 2,
  );
  const launches = [...routerClassic, ...state.classic.launches].sort(
    (left, right) => {
      const coverageOrder =
        Number(left.claimMode !== "unsupported") -
        Number(right.claimMode !== "unsupported");
      if (coverageOrder !== 0) return coverageOrder;
      return (left.symbol ?? left.name ?? left.token).localeCompare(
        right.symbol ?? right.name ?? right.token,
      );
    },
  );
  const group = document.createElement("li");
  group.className = "asset-group classic-launch-group";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const identity = document.createElement("span");
  identity.className = "asset-group-identity";
  const name = document.createElement("strong");
  name.textContent = "Classic Launches";
  const detail = document.createElement("span");
  detail.textContent = "Launcher-Historie + offizieller Launch Router";
  identity.append(name, detail);

  const value = document.createElement("span");
  value.className = "asset-group-value";
  const count = document.createElement("strong");
  const hint = document.createElement("span");
  if (state.account === null) {
    count.textContent = "Onchain";
    hint.textContent = "Nach Verbindung";
  } else if (
    state.classic.status === "loading" ||
    state.router.status === "loading"
  ) {
    count.textContent = "Wird gelesen";
    hint.textContent = "V2 und V3";
  } else if (state.classic.error || state.router.error) {
    count.textContent = "Nicht verfügbar";
    hint.textContent = "Hook-Claim bleibt aktiv";
  } else {
    const unsupported = routerClassic.filter(
      ({ claimMode }) => claimMode === "unsupported",
    ).length;
    count.textContent = `${launches.length} erkannt`;
    hint.textContent = unsupported
      ? `${unsupported} neuer Hook gesperrt`
      : "Alle über Classic-Hooks abgedeckt";
  }
  value.append(count, hint);
  summary.append(identity, value, disclosureIndicator());
  details.append(summary);

  if (launches.length > 0) {
    const list = document.createElement("ul");
    list.className = "asset-list";
    list.replaceChildren(...launches.map(buildClassicLaunchRow));
    details.append(list);
  }
  group.append(details);
  return group;
}

function renderRows() {
  const claims = CLAIMS.map((claim) => ({
    ...claim,
    ...(state.claims.get(claim.id) ?? {
      amount: 0n,
      recipientMatches: false,
      status: "loading",
    }),
  }));

  const visibleAssetClaims =
    state.account === null
      ? claims.filter(({ kind }) => kind === "asset")
      : claims.filter(({ kind, amount }) => kind === "asset" && amount > 0n);

  if (state.account === null) {
    for (const claim of claims) claim.status = "disconnected";
  }

  const nativeRows = claims
    .filter(({ kind }) => kind === "native")
    .map(buildRow);

  const assetGroup = document.createElement("li");
  assetGroup.className = "asset-group";
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const identity = document.createElement("span");
  identity.className = "asset-group-identity";
  const name = document.createElement("strong");
  name.textContent = "Stock-Asset-Gebühren";
  const detail = document.createElement("span");
  detail.textContent = "V1 und gemeinsamer V2/V3-Hook";
  identity.append(name, detail);

  const value = document.createElement("span");
  value.className = "asset-group-value";
  const count = document.createElement("strong");
  count.textContent =
    state.account === null
      ? `${claims.filter(({ kind }) => kind === "asset").length} geprüft`
      : `${visibleAssetClaims.length} offen`;
  const hint = document.createElement("span");
  hint.textContent =
    visibleAssetClaims.length > 0
      ? "Details anzeigen"
      : "Keine Asset-Fees offen";
  value.append(count, hint);
  summary.append(identity, value, disclosureIndicator());
  details.append(summary);

  if (visibleAssetClaims.length > 0) {
    const assetList = document.createElement("ul");
    assetList.className = "asset-list";
    assetList.replaceChildren(...visibleAssetClaims.map(buildRow));
    details.append(assetList);
  }

  assetGroup.append(details);
  elements.claimRows.replaceChildren(
    ...nativeRows,
    buildClassicLaunchGroup(),
    assetGroup,
    buildCustomGroup(),
  );
}

function allClaimDefinitions() {
  return [
    ...CLAIMS,
    ...state.custom.launches.filter(
      ({ standardClaimBindingVerified }) =>
        standardClaimBindingVerified === true,
    ),
    ...state.customV2.sources,
    ...state.router.launches.flatMap((launch) => {
      if (launch.launchKind !== 1 || launch.claimMode !== "manual") return [];
      return Array.isArray(launch.claimDefinitions)
        ? launch.claimDefinitions
        : [launch];
    }),
  ];
}

function claimableClaims({ ignoreConfirmedBatch = false } = {}) {
  if (state.confirmedBatch && !ignoreConfirmedBatch) return [];
  return allClaimDefinitions().filter((claim) => {
    const current = state.claims.get(claim.id);
    if (claim.kind === "custom") {
      const classification = customClaimDefinitionClassification(
        claim,
        current,
      );
      if (classification !== "ready") return false;
    }
    return (
      hookVerified(claim) &&
      current?.recipientMatches === true &&
      claimHasOpenAmount(current)
    );
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function claimSafetyError({ ignoreConfirmedBatch = false } = {}) {
  if (state.confirmedBatch && !ignoreConfirmedBatch)
    return "Ein bestätigter Claim-Batch wartet noch auf einen finalisierten Onchain-Stand";
  if (state.router.status !== "ready" || state.router.verified !== true)
    return "Der Launch-Stamp-Router ist nicht vollständig verifiziert";
  if (
    state.classic.status !== "ready" ||
    state.classic.launchersVerified !== true
  )
    return "Die Classic-Launchliste ist nicht vollständig verifiziert";
  if (
    !["ready", "retired"].includes(state.custom.status) ||
    state.custom.registryVerified !== true
  )
    return "Die Custom Registry ist nicht vollständig verifiziert";
  if (!["ready", "hold"].includes(state.customV2.status))
    return "Das Custom-V2-Release ist nicht vollständig verifiziert";
  if (
    state.custom.launches.some((launch) =>
      ["adapter-required", "blocked"].includes(
        customLaunchClassification(launch),
      ),
    )
  )
    return "Mindestens eine Custom-V1-Feequelle ist nicht sicher claimbar";
  if (
    state.customV2.sources.some(
      (source) => customV2SourceClassification(source) === "blocked",
    )
  )
    return "Mindestens eine Custom-V2-Source-Bindung stimmt nicht";
  if (routerClaimCoverage(state.router.launches).blocked.length > 0)
    return "Mindestens eine Router-Claim-Bindung konnte nicht verifiziert werden";
  if (HOOKS.some(({ id }) => state.hooks.get(id)?.verified !== true))
    return "Mindestens eine Classic- oder Stock-Bindung stimmt nicht";
  if (CLAIMS.some(({ id }) => state.claims.get(id)?.status === "failed"))
    return "Mindestens ein bekanntes Guthaben konnte nicht gelesen werden";
  if (claimableClaims({ ignoreConfirmedBatch }).length > MAX_BATCH_CALLS)
    return `Mehr als ${MAX_BATCH_CALLS} offene Claims passen nicht sicher in einen atomaren Batch`;
  return null;
}

function claimInventoryTotals() {
  const claimable = claimableClaims();
  const nativeTotal = claimable
    .filter(
      ({ kind, unit }) =>
        kind === "native" || (kind === "custom" && unit === "ETH"),
    )
    .reduce(
      (sum, claim) => sum + (state.claims.get(claim.id)?.amount ?? 0n),
      0n,
    );
  const assetCount =
    claimable.filter(
      ({ kind, unit }) =>
        kind === "asset" || (kind === "custom" && unit !== "ETH"),
    ).length +
    claimable.filter(
      (claim) => (state.claims.get(claim.id)?.secondaryAmount ?? 0n) > 0n,
    ).length;
  return { assetCount, claimable, nativeTotal };
}

function scanIsLoading() {
  return (
    state.scanInProgress ||
    state.custom.status === "loading" ||
    state.customV2.status === "loading" ||
    state.classic.status === "loading" ||
    state.router.status === "loading"
  );
}

function scanNeedsRetry(verifiedHooks) {
  return (
    !["ready", "retired"].includes(state.custom.status) ||
    state.custom.registryVerified !== true ||
    !["ready", "hold"].includes(state.customV2.status) ||
    state.classic.status !== "ready" ||
    state.classic.launchersVerified !== true ||
    state.router.status !== "ready" ||
    state.router.verified !== true ||
    verifiedHooks !== HOOKS.length ||
    CLAIMS.some(({ id }) => state.claims.get(id)?.status === "failed")
  );
}

function currentInventoryIsDisplayReady(verifiedHooks) {
  return !scanIsLoading() && !scanNeedsRetry(verifiedHooks);
}

function saveCurrentScanSnapshot(blockTag) {
  const { assetCount, claimable, nativeTotal } = claimInventoryTotals();
  try {
    const snapshot = createScanSnapshot({
      account: TREASURY,
      chainId: MAINNET_CHAIN_ID,
      blockNumber: BigInt(blockTag),
      nativeWei: nativeTotal,
      claimCount: claimable.length,
      assetCount,
    });
    state.scanSnapshot = snapshot;
    window.localStorage.setItem(
      SCAN_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
  } catch {
    // The snapshot is display-only. Claim authorization never depends on it.
  }
}

function renderSummary() {
  const { assetCount, claimable, nativeTotal } = claimInventoryTotals();
  const verifiedHooks = HOOKS.filter(
    ({ id }) => state.hooks.get(id)?.verified === true,
  ).length;
  const customAdapterBlockers = state.custom.launches.filter(
    (launch) => customLaunchClassification(launch) === "adapter-required",
  );
  const customBindingBlockers = state.custom.launches.filter(
    (launch) => customLaunchClassification(launch) === "blocked",
  );
  const customV2BindingBlockers = state.customV2.sources.filter(
    (source) => customV2SourceClassification(source) === "blocked",
  );
  const { blocked: routerBindingBlockers, unsupported: excludedRouterClaims } =
    routerClaimCoverage(state.router.launches);
  const coverageNotice = document.querySelector("[data-coverage-notice]");
  coverageNotice.hidden = excludedRouterClaims.length === 0;
  coverageNotice.textContent = excludedRouterClaims.length
    ? `${excludedRouterClaims.length} weitere Quellen sind noch nicht unterstützt und nicht in diesem Claim enthalten. Ihre Gebühren bleiben unverändert. Details stehen unten.`
    : "";

  const connected = state.account !== null;
  const correctWallet = connected && isTreasury(state.account);
  const correctNetwork = state.chainId === MAINNET_CHAIN_ID;
  const loading = scanIsLoading();
  const displayCurrent =
    correctWallet &&
    correctNetwork &&
    currentInventoryIsDisplayReady(verifiedHooks);
  const snapshotMatchesVisibleWallet =
    !connected || (correctWallet && correctNetwork);
  const displaySnapshot =
    displayCurrent || !snapshotMatchesVisibleWallet ? null : state.scanSnapshot;
  const displayNative = displayCurrent
    ? nativeTotal
    : displaySnapshot
      ? BigInt(displaySnapshot.nativeWei)
      : null;
  const displayClaimCount = displayCurrent
    ? claimable.length
    : displaySnapshot?.claimCount ?? null;
  const displayAssetCount = displayCurrent
    ? assetCount
    : displaySnapshot?.assetCount ?? 0;

  elements.total.textContent =
    displayNative === null ? (loading ? "…" : "—") : `${formatEth(displayNative)} ETH`;
  elements.claimCount.textContent =
    displayClaimCount === null
      ? loading
        ? "Fees werden geprüft"
        : "Noch nicht geprüft"
      : `${displayClaimCount} ${displayClaimCount === 1 ? "Claim" : "Claims"}${displayAssetCount > 0 ? ` · +${displayAssetCount} Assets` : ""}`;
  elements.totalLabel.textContent = displayCurrent
    ? "Geprüfte Gebühren"
    : displaySnapshot
      ? loading
        ? "Letzter Stand · wird aktualisiert"
        : "Letzter Stand"
      : loading
        ? "Wird geprüft"
        : "Zu claimen";
  elements.totalCard.dataset.state = displayCurrent
    ? "ready"
    : displaySnapshot
      ? "cached"
      : loading
        ? "loading"
        : "idle";
  elements.account.textContent = state.account
    ? shortAddress(state.account)
    : "Nicht verbunden";
  elements.network.textContent = DEMO_MODE
    ? "Ethereum · QA"
    : state.chainId === MAINNET_CHAIN_ID
      ? "Ethereum"
      : state.account
        ? "Falsches Netzwerk"
        : "Ethereum";
  elements.batchMode.textContent = state.capability
    ? "Eine MetaMask-Bestätigung"
    : state.capabilityStatus === "failed"
      ? "Erneut prüfen"
      : state.account
      ? "Nicht verfügbar"
      : "Batch wird geprüft";
  elements.content.setAttribute("aria-busy", String(state.busy || loading));
  elements.network.dataset.state = !connected
    ? "idle"
    : correctNetwork
      ? "ready"
      : "wrong";
  elements.metamaskOpen.hidden = !state.walletMissing;
  elements.walletState.textContent = !connected
    ? "Reward Wallet nicht verbunden"
    : !correctNetwork
      ? "Ethereum Mainnet auswählen"
      : !correctWallet
        ? "Falsches MetaMask-Konto"
        : `Reward Wallet verbunden · ${shortAddress(state.account)}`;
  elements.walletState.dataset.state =
    correctWallet && correctNetwork
      ? "ready"
      : connected
        ? "wrong"
        : "idle";

  if (!connected) {
    elements.actionLabel.textContent = state.walletMissing
      ? "MetaMask erneut suchen"
      : "Reward Wallet verbinden";
    elements.actionDetail.textContent = "Reward Wallet · endet 376C";
    elements.action.disabled = state.busy;
  } else if (!correctNetwork) {
    elements.actionLabel.textContent = "Zu Ethereum wechseln";
    elements.actionDetail.textContent = "Ein Klick";
    elements.action.disabled = state.busy;
  } else if (!correctWallet) {
    elements.actionLabel.textContent = "MetaMask-Konto wechseln";
    elements.actionDetail.textContent = "Wallet · endet 376C";
    elements.action.disabled = state.busy;
  } else if (loading) {
    elements.actionLabel.textContent = "Fees werden geprüft";
    elements.actionDetail.textContent = displaySnapshot
      ? "Letzter Stand bleibt sichtbar"
      : "Automatisch nach der Verbindung";
    elements.action.disabled = true;
  } else if (state.confirmedBatch) {
    const resumable =
      !state.confirmedBatch.invalid &&
      ["submitting", "pending"].includes(state.confirmedBatch.phase);
    elements.actionLabel.textContent = state.confirmedBatch.invalid
      ? "Claim-Status prüfen"
      : resumable
        ? "Claim-Batch sicher fortsetzen"
        : "Claim bereits bestätigt";
    elements.actionDetail.textContent = state.confirmedBatch.invalid
      ? "Lokale Sperre unvollständig · nichts erneut senden"
      : (state.confirmedBatch.failureStatus ?? 0) >= 600
        ? "Mögliche Teil-Ausführung muss onchain geprüft werden"
        : resumable
          ? "Exakt dieselbe Batch-ID · kein zweiter Claim"
          : `Neuer Scan erst nach finalisiertem Block ${highestConfirmedReceiptBlock()?.toString()}`;
    elements.action.disabled = state.busy || !resumable;
  } else if (scanNeedsRetry(verifiedHooks)) {
    elements.actionLabel.textContent = "Erneut prüfen";
    elements.actionDetail.textContent = "Reward Wallet bleibt verbunden";
    elements.action.disabled = state.busy;
  } else if (customBindingBlockers.length > 0) {
    elements.actionLabel.textContent = "Neue Quelle prüfen";
    elements.actionDetail.textContent = "Claim bleibt sicher gesperrt";
    elements.action.disabled = true;
  } else if (customV2BindingBlockers.length > 0) {
    elements.actionLabel.textContent = "Neue Quelle prüfen";
    elements.actionDetail.textContent = "Claim bleibt sicher gesperrt";
    elements.action.disabled = true;
  } else if (customAdapterBlockers.length > 0) {
    elements.actionLabel.textContent = "Neue Quelle prüfen";
    elements.actionDetail.textContent = "Claim bleibt sicher gesperrt";
    elements.action.disabled = true;
  } else if (routerBindingBlockers.length > 0) {
    elements.actionLabel.textContent = "Quellenbindung prüfen";
    elements.actionDetail.textContent = "Eine Contract-Bindung konnte nicht verifiziert werden";
    elements.action.disabled = true;
  } else if (claimable.length > MAX_BATCH_CALLS) {
    elements.actionLabel.textContent = "Zu viele offene Claims";
    elements.actionDetail.textContent = "Details prüfen";
    elements.action.disabled = true;
  } else if (claimable.length === 0) {
    elements.actionLabel.textContent = "Fees aktualisieren";
    elements.actionDetail.textContent = "Aktuell nichts offen";
    elements.action.disabled = state.busy;
  } else if (state.capabilityStatus === "failed") {
    elements.actionLabel.textContent = "Erneut prüfen";
    elements.actionDetail.textContent = "MetaMask-Verbindung aktualisieren";
    elements.action.disabled = state.busy;
  } else if (!state.capability) {
    elements.actionLabel.textContent = "MetaMask nicht kompatibel";
    elements.actionDetail.textContent = "Gemeinsamer Claim nicht unterstützt";
    elements.action.disabled = true;
  } else {
    elements.actionLabel.textContent = "Geprüfte Fees claimen";
    const claimLabel = `${claimable.length} ${claimable.length === 1 ? "Claim" : "Claims"}`;
    elements.actionDetail.textContent = `${claimLabel} · eine Bestätigung${excludedRouterClaims.length ? " · weitere Quellen ausgeschlossen" : ""}`;
    elements.action.disabled = state.busy;
  }

  renderRows();
}

async function readCustomRegistryLogs(blockTag) {
  const latest = BigInt(blockTag);
  const topics = [Object.values(CUSTOM_EVENT_TOPICS)];
  const logs = [];
  for (
    let fromBlock = CUSTOM_REGISTRY.startBlock;
    fromBlock <= latest;
    fromBlock += EVENT_LOG_CHUNK_SIZE
  ) {
    const toBlock =
      fromBlock + EVENT_LOG_CHUNK_SIZE - 1n < latest
        ? fromBlock + EVENT_LOG_CHUNK_SIZE - 1n
        : latest;
    logs.push(
      ...(await request("eth_getLogs", [
        {
          address: CUSTOM_REGISTRY.address,
          fromBlock: toQuantityHex(fromBlock),
          toBlock: toQuantityHex(toBlock),
          topics,
        },
      ])),
    );
  }
  return logs;
}

async function readClassicLauncherLogs(launcher, blockTag) {
  const latest = BigInt(blockTag);
  const logs = [];
  for (
    let fromBlock = launcher.startBlock;
    fromBlock <= latest;
    fromBlock += EVENT_LOG_CHUNK_SIZE
  ) {
    const toBlock =
      fromBlock + EVENT_LOG_CHUNK_SIZE - 1n < latest
        ? fromBlock + EVENT_LOG_CHUNK_SIZE - 1n
        : latest;
    logs.push(
      ...(await request("eth_getLogs", [
        {
          address: launcher.address,
          fromBlock: toQuantityHex(fromBlock),
          toBlock: toQuantityHex(toBlock),
          topics: [launcher.eventTopic],
        },
      ])),
    );
  }
  return logs;
}

async function readClassicLaunches(blockTag) {
  state.classic = {
    status: "loading",
    launchersVerified: false,
    launches: [],
    error: null,
  };
  renderSummary();
  try {
    const launcherResults = await Promise.all(
      CLASSIC_LAUNCHERS.map(async (launcher) => {
        const [runtimeCode, logs] = await Promise.all([
          request("eth_getCode", [launcher.address, blockTag]),
          readClassicLauncherLogs(launcher, blockTag),
        ]);
        if (
          keccak256Hex(runtimeCode).toLowerCase() !==
          launcher.runtimeCodeHash.toLowerCase()
        )
          throw new Error(`${launcher.name} Launcher stimmt nicht`);
        return logs.map((log) => ({ launcher, log }));
      }),
    );
    const launches = reduceClassicLaunchLogs(launcherResults.flat());
    state.classic = {
      status: "ready",
      launchersVerified: true,
      launches,
      error: null,
    };
  } catch (error) {
    state.classic = {
      status: "failed",
      launchersVerified: false,
      launches: [],
      error:
        error instanceof Error
          ? error.message
          : "Classic Launches konnten nicht gelesen werden",
    };
  }
}

async function readLaunchStampLogs(toBlock) {
  const logs = [];
  for (
    let fromBlock = LAUNCH_STAMP_ROUTER.startBlock;
    fromBlock <= toBlock;
    fromBlock += EVENT_LOG_CHUNK_SIZE
  ) {
    const chunkEnd =
      fromBlock + EVENT_LOG_CHUNK_SIZE - 1n < toBlock
        ? fromBlock + EVENT_LOG_CHUNK_SIZE - 1n
        : toBlock;
    const filter = {
      address: LAUNCH_STAMP_ROUTER.address,
      fromBlock: toQuantityHex(fromBlock),
      toBlock: toQuantityHex(chunkEnd),
      topics: [LAUNCH_STAMP_TOPICS.launchStamped],
    };
    const responses = await routerQuorumRequest("eth_getLogs", [filter]);
    const fingerprints = responses.map(launchStampLogSetFingerprint);
    if (new Set(fingerprints).size !== 1)
      throw new Error("Die Router-Loghistorie stimmt im RPC-Quorum nicht überein");
    logs.push(...responses[0]);
    if (logs.length > MAX_ROUTER_LAUNCHES)
      throw new Error("Die Router-Launchliste überschreitet das sichere Scan-Limit");
  }
  return logs;
}

async function readRouterQuorumBlock(blockTag) {
  const blocks = await routerQuorumRequest("eth_getBlockByNumber", [
    blockTag,
    false,
  ]);
  return exactRouterFinalizedCheckpoint(
    blocks,
    LAUNCH_STAMP_ROUTER.startBlock,
  );
}

async function readRouterFinalizedBoundary() {
  const blocks = await routerQuorumRequest("eth_getBlockByNumber", [
    LAUNCH_STAMP_ROUTER.finalizedTag,
    false,
  ]);
  return routerFinalizedBoundary(
    blocks,
    LAUNCH_STAMP_ROUTER.startBlock,
    LAUNCH_STAMP_ROUTER.maximumFinalizedSpread,
  );
}

async function verifyLaunchStampInfrastructure(blockTag) {
  const [
    routerCode,
    chainIdWord,
    permitAuthorityWord,
    permitAuthorityRuntimeWord,
    graphFactoryWord,
    graphFactoryRuntimeWord,
    poolManagerWord,
    poolManagerRuntimeWord,
  ] = await Promise.all([
    request("eth_getCode", [LAUNCH_STAMP_ROUTER.address, blockTag]),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.permitAuthority,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.permitAuthorityRuntimeCodeHash,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.graphFactory,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.graphFactoryRuntimeCodeHash,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.poolManager,
      blockTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      LAUNCH_STAMP_SELECTORS.poolManagerRuntimeCodeHash,
      blockTag,
    ),
  ]);
  const permitAuthority = decodeAddress(permitAuthorityWord);
  const graphFactory = decodeAddress(graphFactoryWord);
  const poolManager = decodeAddress(poolManagerWord);
  if (
    keccak256Hex(routerCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.runtimeCodeHash ||
    decodeUint256(chainIdWord) !== 1n ||
    permitAuthority.toLowerCase() !==
      LAUNCH_STAMP_ROUTER.permitAuthority.address.toLowerCase() ||
    decodeBytes32(permitAuthorityRuntimeWord) !==
      LAUNCH_STAMP_ROUTER.permitAuthority.runtimeCodeHash ||
    graphFactory.toLowerCase() !==
      LAUNCH_STAMP_ROUTER.graphFactory.address.toLowerCase() ||
    decodeBytes32(graphFactoryRuntimeWord) !==
      LAUNCH_STAMP_ROUTER.graphFactory.runtimeCodeHash ||
    poolManager.toLowerCase() !==
      LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase() ||
    decodeBytes32(poolManagerRuntimeWord) !==
      LAUNCH_STAMP_ROUTER.poolManager.runtimeCodeHash
  )
    throw new Error("Launch-Stamp-Router-Bindung stimmt nicht");

  const [permitCode, graphCode, poolManagerCode] = await Promise.all([
    request("eth_getCode", [permitAuthority, blockTag]),
    request("eth_getCode", [graphFactory, blockTag]),
    request("eth_getCode", [poolManager, blockTag]),
  ]);
  if (
    keccak256Hex(permitCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.permitAuthority.runtimeCodeHash ||
    keccak256Hex(graphCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.graphFactory.runtimeCodeHash ||
    keccak256Hex(poolManagerCode).toLowerCase() !==
      LAUNCH_STAMP_ROUTER.poolManager.runtimeCodeHash
  )
    throw new Error("Launch-Stamp-Infrastruktur-Runtime stimmt nicht");
}

function routerProfileBindingMatches(launch, profile) {
  return profile.bindings.some(
    ({ launchId, token, source, runtimeCodeHash }) =>
      launch.launchId === launchId &&
      (!token || launch.token.toLowerCase() === token.toLowerCase()) &&
      launch.hook.toLowerCase() === source.toLowerCase() &&
      launch.runtimeCodeHash === runtimeCodeHash,
  );
}

function routerFeeVaultBinding(launch, profile) {
  return profile.bindings.find(
    ({ launchId, token, hook, hookRuntimeCodeHash }) =>
      launch.launchId === launchId &&
      launch.token.toLowerCase() === token.toLowerCase() &&
      launch.hook.toLowerCase() === hook.toLowerCase() &&
      launch.runtimeCodeHash === hookRuntimeCodeHash,
  );
}

async function verifyRouterProfileComponent(launch, binding, blockTag) {
  const [launchIdWord, proofValue, runtimeWord, runtimeCode] =
    await Promise.all([
      readContractWord(
        LAUNCH_STAMP_ROUTER.address,
        launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.launchIdByComponent,
          binding.source,
        ),
        blockTag,
      ),
      request("eth_call", [
        {
          to: LAUNCH_STAMP_ROUTER.address,
          data: launchStampAddressReadData(
            LAUNCH_STAMP_SELECTORS.stampProof,
            binding.source,
          ),
        },
        blockTag,
      ]),
      readContractWord(
        LAUNCH_STAMP_ROUTER.address,
        launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.componentRuntimeCodeHash,
          binding.source,
        ),
        blockTag,
      ),
      request("eth_getCode", [binding.source, blockTag]),
    ]);
  const proof = decodeLaunchStampProof(proofValue);
  const runtimeCodeHash = decodeBytes32(runtimeWord);
  if (
    decodeBytes32(launchIdWord) !== launch.launchId ||
    proof.launchId !== launch.launchId ||
    proof.stampHash !== launch.stampHash ||
    runtimeCodeHash !== binding.sourceRuntimeCodeHash ||
    keccak256Hex(runtimeCode).toLowerCase() !==
      binding.sourceRuntimeCodeHash.toLowerCase()
  )
    throw new Error("Custom-Vault-Stamp oder Runtime stimmt nicht");
}

async function tryRouterClaimProfile(
  launch,
  runtimeCode,
  profile,
  blockTag,
) {
  if (!routerProfileBindingMatches(launch, profile)) return null;
  try {
    const [
      recipientWord,
      feeWord,
      accruedWord,
      feeDenominatorWord,
      poolManagerWord,
      boundTokenWord,
      nftWord,
      initializedWord,
    ] = await Promise.all([
      readContractWord(launch.hook, profile.recipient, blockTag),
      readContractWord(launch.hook, profile.feeBps, blockTag),
      readContractWord(launch.hook, profile.accrued, blockTag),
      profile.feeDenominatorBps
        ? readContractWord(launch.hook, profile.feeDenominatorBps, blockTag)
        : null,
      profile.poolManager
        ? readContractWord(launch.hook, profile.poolManager, blockTag)
        : null,
      profile.boundToken
        ? readContractWord(launch.hook, profile.boundToken, blockTag)
        : null,
      profile.nft ? readContractWord(launch.hook, profile.nft, blockTag) : null,
      profile.initialized
        ? readContractWord(launch.hook, profile.initialized, blockTag)
        : null,
    ]);
    const amount = decodeUint256(accruedWord);
    if (
      !isTreasury(decodeAddress(recipientWord)) ||
      decodeUint256(feeWord) !== profile.expectedFeeBps ||
      (feeDenominatorWord !== null &&
        decodeUint256(feeDenominatorWord) !==
          profile.expectedFeeDenominatorBps) ||
      (poolManagerWord !== null &&
        decodeAddress(poolManagerWord).toLowerCase() !==
          LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase()) ||
      (boundTokenWord !== null &&
        decodeAddress(boundTokenWord).toLowerCase() !==
          launch.token.toLowerCase()) ||
      (nftWord !== null &&
        decodeAddress(nftWord).toLowerCase() !==
          profile.expectedNft.toLowerCase()) ||
      (initializedWord !== null && !decodeBool(initializedWord))
    )
      return null;
    if (amount > 0n) {
      const simulated = await readContractWord(
        launch.hook,
        profile.claim,
        blockTag,
        TREASURY,
      );
      if (decodeUint256(simulated) !== amount)
        throw new Error("Custom-Claim-Simulation stimmt nicht");
    }
    return {
      ...launch,
      id: `router-custom:${launch.launchId}`,
      name: "Custom · Router",
      detail: shortAddress(launch.token),
      unit: "ETH",
      decimals: 18,
      kind: "custom",
      origin: "launch-stamp-router",
      address: launch.hook,
      claimMode: "manual",
      claimProfile: profile.id,
      readData: profile.accrued,
      claimData: profile.claim,
      claimBindingVerified: true,
      recipientMatches: true,
      amount,
      status: "ready",
    };
  } catch {
    return null;
  }
}

async function tryRouterFeeVaultProfile(launch, profile, blockTag) {
  const binding = routerFeeVaultBinding(launch, profile);
  if (!binding) return null;
  try {
    await verifyRouterProfileComponent(launch, binding, blockTag);
    const nativeAsset = CUSTOM_V2_POLICY.nativeAsset;
    const nativeReadData = `${profile.accrued}${encodeAddressArgument(nativeAsset)}`;
    const tokenReadData = `${profile.accrued}${encodeAddressArgument(launch.token)}`;
    const nativeClaimData = `${profile.claim}${encodeAddressArgument(nativeAsset)}`;
    const tokenClaimData = `${profile.claim}${encodeAddressArgument(launch.token)}`;
    const [
      hookVaultWord,
      recipientWord,
      feePpmWord,
      feeDenominatorWord,
      poolManagerWord,
      authorizedAdapterWord,
      authorizedAdapterCodeHashWord,
      bindingAuthorityWord,
      nativeAmountWord,
      tokenAmountWord,
    ] = await Promise.all([
      readContractWord(launch.hook, profile.hookFeeVault, blockTag),
      readContractWord(binding.source, profile.recipient, blockTag),
      readContractWord(binding.source, profile.feePpm, blockTag),
      readContractWord(binding.source, profile.feeDenominatorPpm, blockTag),
      readContractWord(binding.source, profile.poolManager, blockTag),
      readContractWord(binding.source, profile.authorizedAdapter, blockTag),
      readContractWord(
        binding.source,
        profile.authorizedAdapterCodeHash,
        blockTag,
      ),
      readContractWord(binding.source, profile.bindingAuthority, blockTag),
      readContractWord(binding.source, nativeReadData, blockTag),
      readContractWord(binding.source, tokenReadData, blockTag),
    ]);
    if (
      decodeAddress(hookVaultWord).toLowerCase() !==
        binding.source.toLowerCase() ||
      !isTreasury(decodeAddress(recipientWord)) ||
      decodeUint256(feePpmWord) !== profile.expectedFeePpm ||
      decodeUint256(feeDenominatorWord) !==
        profile.expectedFeeDenominatorPpm ||
      decodeAddress(poolManagerWord).toLowerCase() !==
        LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase() ||
      decodeAddress(authorizedAdapterWord).toLowerCase() !==
        launch.hook.toLowerCase() ||
      decodeBytes32(authorizedAdapterCodeHashWord) !==
        binding.hookRuntimeCodeHash ||
      decodeAddress(bindingAuthorityWord) !== nativeAsset
    )
      throw new Error("Custom-Vault-Claim-Bindung stimmt nicht");

    const amount = decodeUint256(nativeAmountWord);
    const secondaryAmount = decodeUint256(tokenAmountWord);
    await Promise.all(
      [
        { amount, claimData: nativeClaimData },
        { amount: secondaryAmount, claimData: tokenClaimData },
      ].map(async (leg) => {
        if (leg.amount === 0n) return;
        const simulated = await readContractWord(
          binding.source,
          leg.claimData,
          blockTag,
          TREASURY,
        );
        if (decodeUint256(simulated) !== leg.amount)
          throw new Error("Custom-Vault-Claim-Simulation stimmt nicht");
      }),
    );

    const id = `router-custom:${launch.launchId}`;
    const common = {
      launchId: launch.launchId,
      token: launch.token,
      hook: launch.hook,
      launchKind: launch.launchKind,
      kind: "custom",
      origin: "launch-stamp-router",
      address: binding.source,
      provenanceVerified: true,
      runtimeVerified: true,
      sourceRuntimeVerified: true,
      claimMode: "manual",
      claimProfile: profile.id,
      claimBindingVerified: true,
      recipientMatches: true,
      status: "ready",
    };
    const claimDefinitions = [
      {
        ...common,
        id: `${id}:native`,
        name: "Custom · Router",
        detail: `${shortAddress(launch.token)} · ETH`,
        unit: "ETH",
        decimals: 18,
        readData: nativeReadData,
        claimData: nativeClaimData,
        amount,
      },
      {
        ...common,
        id: `${id}:${launch.token.toLowerCase()}`,
        name: "Custom · Router",
        detail: `${shortAddress(launch.token)} · ${profile.secondaryUnit}`,
        asset: launch.token,
        unit: profile.secondaryUnit,
        decimals: profile.secondaryDecimals,
        readData: tokenReadData,
        claimData: tokenClaimData,
        amount: secondaryAmount,
      },
    ];
    return {
      ...launch,
      ...common,
      id,
      name: "Custom · Router",
      detail: shortAddress(launch.token),
      unit: "ETH",
      decimals: 18,
      secondaryAsset: launch.token,
      secondaryUnit: profile.secondaryUnit,
      secondaryDecimals: profile.secondaryDecimals,
      amount,
      secondaryAmount,
      claimDefinitions,
    };
  } catch {
    return null;
  }
}

async function readRouterCustomClaim(launch, runtimeCode, blockTag) {
  for (const profile of [
    ROUTER_CUSTOM_CLAIM_PROFILES.nativeAccumulatorV1,
    ROUTER_CUSTOM_CLAIM_PROFILES.shardLauncherFeesV1,
    ROUTER_CUSTOM_CLAIM_PROFILES.protocolFeeSourceV1,
  ]) {
    const claim = await tryRouterClaimProfile(
      launch,
      runtimeCode,
      profile,
      blockTag,
    );
    if (claim) return claim;
  }

  const feeVaultClaim = await tryRouterFeeVaultProfile(
    launch,
    ROUTER_CUSTOM_CLAIM_PROFILES.isolatedAfterSwapFeeVaultV2,
    blockTag,
  );
  if (feeVaultClaim) return feeVaultClaim;

  const redeemer = ROUTER_CUSTOM_CLAIM_PROFILES.dualCurrencyRedeemerV1;
  try {
    if (!routerProfileBindingMatches(launch, redeemer))
      throw new Error("Kein freigegebenes Mehrwährungs-Claim-Profil");
    const [
      recipientWord,
      feePipsWord,
      poolManagerWord,
      currency0Word,
      currency1Word,
      poolIdWord,
      nativeAmountWord,
      tokenAmountWord,
    ] = await Promise.all([
      readContractWord(launch.hook, redeemer.recipient, blockTag),
      readContractWord(launch.hook, redeemer.feePips, blockTag),
      readContractWord(launch.hook, redeemer.poolManager, blockTag),
      readContractWord(launch.hook, redeemer.currency0, blockTag),
      readContractWord(launch.hook, redeemer.currency1, blockTag),
      readContractWord(launch.hook, redeemer.poolId, blockTag),
      readContractWord(
        LAUNCH_STAMP_ROUTER.poolManager.address,
        poolManagerBalanceOfData(
          redeemer.balanceOf,
          launch.hook,
          CUSTOM_V2_POLICY.nativeAsset,
        ),
        blockTag,
      ),
      readContractWord(
        LAUNCH_STAMP_ROUTER.poolManager.address,
        poolManagerBalanceOfData(
          redeemer.balanceOf,
          launch.hook,
          launch.token,
        ),
        blockTag,
      ),
    ]);
    if (
      !isTreasury(decodeAddress(recipientWord)) ||
      decodeUint256(feePipsWord) !== redeemer.expectedFeePips ||
      decodeAddress(poolManagerWord).toLowerCase() !==
        LAUNCH_STAMP_ROUTER.poolManager.address.toLowerCase() ||
      decodeAddress(currency0Word).toLowerCase() !==
        CUSTOM_V2_POLICY.nativeAsset.toLowerCase() ||
      decodeAddress(currency1Word).toLowerCase() !==
        launch.token.toLowerCase() ||
      decodeBytes32(poolIdWord) !== launch.poolId
    )
      throw new Error("Mehrwährungs-Claim-Bindung stimmt nicht");
    const amount = decodeUint256(nativeAmountWord);
    const secondaryAmount = decodeUint256(tokenAmountWord);
    if (amount > 0n || secondaryAmount > 0n) {
      const simulated = await request("eth_call", [
        { from: TREASURY, to: launch.hook, data: redeemer.claim },
        blockTag,
      ]);
      if (simulated !== "0x")
        throw new Error("Mehrwährungs-Claim-Simulation stimmt nicht");
    }
    return {
      ...launch,
      id: `router-custom:${launch.launchId}`,
      name: "Custom · Router",
      detail: shortAddress(launch.token),
      unit: "ETH",
      decimals: 18,
      secondaryAsset: launch.token,
      secondaryUnit: redeemer.secondaryUnit,
      secondaryDecimals: redeemer.secondaryDecimals,
      kind: "custom",
      origin: "launch-stamp-router",
      address: launch.hook,
      claimMode: "manual",
      claimProfile: redeemer.id,
      claimData: redeemer.claim,
      claimBindingVerified: true,
      recipientMatches: true,
      amount,
      secondaryAmount,
      status: "ready",
    };
  } catch {
    // Continue to the explicit unsupported disposition below.
  }

  return {
    ...launch,
    id: `router-custom:${launch.launchId}`,
    name: "Custom · Router",
    detail: shortAddress(launch.token),
    unit: "ETH",
    decimals: 18,
    kind: "custom",
    origin: "launch-stamp-router",
    address: launch.hook,
    claimMode: "unsupported",
    claimProfile: null,
    claimBindingVerified: false,
    recipientMatches: false,
    amount: 0n,
    status: "failed",
  };
}

async function readVerifiedRouterLaunch(candidate, finalizedTag) {
  const [recordValue, tokenLaunchIdWord, poolLaunchIdWord, tokenProofValue] =
    await Promise.all([
    request("eth_call", [
      {
        to: LAUNCH_STAMP_ROUTER.address,
        data: launchStampBytes32ReadData(
          LAUNCH_STAMP_SELECTORS.launchStamp,
          candidate.launchId,
        ),
      },
      finalizedTag,
    ]),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      launchStampAddressReadData(
        LAUNCH_STAMP_SELECTORS.launchIdByToken,
        candidate.token,
      ),
      finalizedTag,
    ),
    readContractWord(
      LAUNCH_STAMP_ROUTER.address,
      launchStampPoolReadData(
        LAUNCH_STAMP_SELECTORS.launchIdByPool,
        candidate.poolManager,
        candidate.poolId,
      ),
      finalizedTag,
    ),
    request("eth_call", [
      {
        to: LAUNCH_STAMP_ROUTER.address,
        data: launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.stampProof,
          candidate.token,
        ),
      },
      finalizedTag,
    ]),
  ]);
  const record = decodeLaunchStampRecord(recordValue);
  const tokenProof = decodeLaunchStampProof(tokenProofValue);
  if (
    decodeBytes32(tokenLaunchIdWord) !== candidate.launchId ||
    decodeBytes32(poolLaunchIdWord) !== candidate.launchId ||
    tokenProof.launchId !== candidate.launchId ||
    tokenProof.stampHash !== candidate.stampHash ||
    record.token.toLowerCase() !== candidate.token.toLowerCase() ||
    record.hook.toLowerCase() !== candidate.hook.toLowerCase() ||
    record.poolManager.toLowerCase() !== candidate.poolManager.toLowerCase() ||
    record.poolId !== candidate.poolId ||
    record.stampHash !== candidate.stampHash
  )
    throw new Error("Launch-Stamp-Record stimmt nicht mit dem Event überein");

  const routeCode = await request("eth_getCode", [
    record.routeLauncher,
    finalizedTag,
  ]);
  if (
    keccak256Hex(routeCode).toLowerCase() !==
    record.routeLauncherRuntimeCodeHash
  )
    throw new Error("Launch-Route-Runtime ist gedriftet");

  const verified = {
    ...candidate,
    ...record,
    launchKind: record.kind,
    provenanceVerified: true,
    runtimeVerified: true,
  };
  if (record.kind === 2) {
    const knownHook = HOOKS.find(
      ({ address }) => address.toLowerCase() === record.hook.toLowerCase(),
    );
    return {
      ...verified,
      claimMode: knownHook ? "covered-by-known-hook" : "unsupported",
      claimProfile: knownHook?.id ?? null,
      claimBindingVerified: Boolean(knownHook),
      amount: 0n,
    };
  }

  const [hookLaunchIdWord, hookProofValue, recordedRuntimeWord, hookCode] =
    await Promise.all([
      readContractWord(
        LAUNCH_STAMP_ROUTER.address,
        launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.launchIdByComponent,
          record.hook,
        ),
        finalizedTag,
      ),
      request("eth_call", [
        {
          to: LAUNCH_STAMP_ROUTER.address,
          data: launchStampAddressReadData(
            LAUNCH_STAMP_SELECTORS.stampProof,
            record.hook,
          ),
        },
        finalizedTag,
      ]),
      readContractWord(
        LAUNCH_STAMP_ROUTER.address,
        launchStampAddressReadData(
          LAUNCH_STAMP_SELECTORS.componentRuntimeCodeHash,
          record.hook,
        ),
        finalizedTag,
      ),
      request("eth_getCode", [record.hook, finalizedTag]),
    ]);
  const hookProof = decodeLaunchStampProof(hookProofValue);
  const recordedRuntime = decodeBytes32(recordedRuntimeWord);
  if (
    decodeBytes32(hookLaunchIdWord) !== candidate.launchId ||
    hookProof.launchId !== candidate.launchId ||
    hookProof.stampHash !== candidate.stampHash ||
    /^0x0{64}$/i.test(recordedRuntime) ||
    keccak256Hex(hookCode).toLowerCase() !== recordedRuntime
  )
    throw new Error("Custom-Hook-Stamp oder Runtime stimmt nicht");

  return readRouterCustomClaim(
    { ...verified, runtimeCodeHash: recordedRuntime },
    hookCode,
    finalizedTag,
  );
}

async function readLaunchStampRouter() {
  for (const key of state.claims.keys()) {
    if (key.startsWith("router-custom:")) state.claims.delete(key);
  }
  state.router = {
    status: "loading",
    verified: false,
    finalizedBlock: null,
    launches: [],
    error: null,
  };
  renderSummary();
  try {
    const finalizedBlock = await readRouterFinalizedBoundary();
    const finalizedTag = toQuantityHex(finalizedBlock);
    const openingBlock = await readRouterQuorumBlock(finalizedTag);
    await verifyLaunchStampInfrastructure(finalizedTag);
    const candidates = reduceLaunchStampLogs(
      await readLaunchStampLogs(finalizedBlock),
    );
    const launches = await mapWithConcurrency(candidates, 8, (candidate) =>
      readVerifiedRouterLaunch(candidate, finalizedTag),
    );
    const closingBlock = await readRouterQuorumBlock(finalizedTag);
    if (
      closingBlock.number !== openingBlock.number ||
      closingBlock.hash !== openingBlock.hash
    )
      throw new Error("Finalisierter Router-Block hat sich während des Scans geändert");
    for (const launch of launches) {
      if (launch.launchKind !== 1 || launch.claimMode !== "manual") continue;
      state.claims.set(launch.id, {
        amount: launch.amount,
        secondaryAmount: launch.secondaryAmount,
        recipientMatches: launch.recipientMatches,
        status: launch.status,
      });
      for (const claim of launch.claimDefinitions ?? []) {
        state.claims.set(claim.id, {
          amount: claim.amount,
          recipientMatches: claim.recipientMatches,
          status: claim.status,
        });
      }
    }
    state.router = {
      status: "ready",
      verified: true,
      finalizedBlock,
      launches,
      error: null,
    };
  } catch (error) {
    state.router = {
      status: "failed",
      verified: false,
      finalizedBlock: null,
      launches: [],
      error:
        error instanceof Error
          ? error.message
          : "Launch-Stamp-Router konnte nicht gelesen werden",
    };
  }
}

async function readCustomLaunch(launch, blockTag) {
  const [runtimeCode, launchStateWord] = await Promise.all([
    request("eth_getCode", [launch.primaryContract, blockTag]),
    request("eth_call", [
      {
        to: CUSTOM_REGISTRY.address,
        data: customLaunchStateData(launch.launchId),
      },
      blockTag,
    ]),
  ]);
  const current = decodeCustomLaunchState(launchStateWord);
  const base = {
    ...launch,
    currentStatus: current.status,
    stateVerified:
      current.feePolicyHash === launch.feePolicy?.feePolicyHash &&
      ((current.status === 2 && launch.finalized && !launch.revoked) ||
        (current.status === 3 && launch.revoked) ||
        (current.status === 1 && !launch.finalized && !launch.revoked)),
    runtimeVerified:
      typeof launch.primaryRuntimeCodeHash === "string" &&
      keccak256Hex(runtimeCode).toLowerCase() ===
        launch.primaryRuntimeCodeHash.toLowerCase(),
  };
  if (
    customLaunchClassification(base) === "no-market" ||
    base.currentStatus !== 2 ||
    base.stateVerified !== true ||
    base.runtimeVerified !== true
  )
    return base;

  try {
    const [recipientWord, accruedWord, totalClaimedWord, feeBpsWord] =
      await Promise.all([
        readContractWord(
          launch.primaryContract,
          CUSTOM_V2_SELECTORS.programmableFeeRecipient,
          blockTag,
        ),
        readContractWord(
          launch.primaryContract,
          readAccruedData({ kind: "custom" }),
          blockTag,
        ),
        readContractWord(
          launch.primaryContract,
          `${CUSTOM_V2_SELECTORS.totalProgrammableFeesClaimed}${"0".repeat(64)}`,
          blockTag,
        ),
        readContractWord(
          launch.primaryContract,
          `${CUSTOM_V2_SELECTORS.programmableFeeBps}${"0".repeat(64)}`,
          blockTag,
        ),
      ]);
    const amount = decodeUint256(accruedWord);
    const feeBps = decodeUint256(feeBpsWord);
    const standardClaimBindingVerified =
      isTreasury(decodeAddress(recipientWord)) &&
      isTreasury(launch.feePolicy.programmableRecipient) &&
      feeBps === BigInt(launch.feePolicy.programmableShareBps);
    return {
      ...base,
      id: `custom-v1-standard:${launch.launchId}`,
      hookId: "custom-v1-standard",
      name: `Custom Launch ${launch.registrationSequence.toString()}`,
      detail: shortAddress(launch.primaryContract),
      unit: "ETH",
      decimals: 18,
      kind: "custom",
      address: launch.primaryContract,
      asset: CUSTOM_V2_POLICY.nativeAsset,
      bindingVerified: standardClaimBindingVerified,
      standardClaimBindingVerified,
      registered: true,
      quarantined: false,
      executable: true,
      recipient: decodeAddress(recipientWord),
      recipientMatches: standardClaimBindingVerified,
      amount,
      totalClaimed: decodeUint256(totalClaimedWord),
      programmableFeeBps: feeBps,
      status: "ready",
    };
  } catch {
    return { ...base, standardClaimBindingVerified: false };
  }
}

async function readCustomRegistry(blockTag) {
  void blockTag;
  for (const key of state.claims.keys()) {
    if (key.startsWith("custom-v1-standard:")) state.claims.delete(key);
  }
  state.custom = {
    status: "retired",
    registryVerified: true,
    launches: [],
    error: null,
  };
  renderSummary();
}

async function readContractWord(address, data, blockTag, from = null) {
  const call = { to: address, data };
  if (from) call.from = from;
  const value = await request("eth_call", [call, blockTag]);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`Ungültige Contract-Antwort von ${shortAddress(address)}`);
  return value;
}

async function verifyCustomV2Infrastructure(release, blockTag) {
  if (release.startBlock > BigInt(blockTag))
    throw new Error("Custom-V2-Deployment-Block liegt in der Zukunft");
  const contractEntries = Object.values(release.contracts);
  const runtimeResults = await Promise.all(
    contractEntries.map(async (contract) => ({
      contract,
      actual: keccak256Hex(
        await request("eth_getCode", [contract.address, blockTag]),
      ).toLowerCase(),
    })),
  );
  if (
    runtimeResults.some(
      ({ contract, actual }) =>
        actual !== contract.runtimeCodeHash.toLowerCase(),
    )
  )
    throw new Error("Custom-V2-Contract-Runtime stimmt nicht");

  const { sourceRegistry, customRegistryV2, customRegistrar, launchStampRouter } =
    release.contracts;
  const [
    registrarChain,
    registrarSourceRegistry,
    registrarCustomRegistry,
    registrarLaunchStampRouter,
    registryChain,
    registryGeneration,
    registryFinality,
    registrySourceRegistry,
    launchStampChain,
    sourceChain,
    sourceDelay,
    sourceRewardWallet,
    sourceClaimSelector,
    sourceInterfaceId,
  ] = await Promise.all([
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.supportedChainId,
      blockTag,
    ),
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.sourceRegistry,
      blockTag,
    ),
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.customRegistryV2,
      blockTag,
    ),
    readContractWord(
      customRegistrar.address,
      CUSTOM_V2_SELECTORS.launchStampRouter,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.registryGeneration,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.minimumFinalityBlocks,
      blockTag,
    ),
    readContractWord(
      customRegistryV2.address,
      CUSTOM_V2_SELECTORS.sourceRegistry,
      blockTag,
    ),
    readContractWord(
      launchStampRouter.address,
      CUSTOM_V2_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.chainId,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.minimumActivationDelayBlocks,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.rewardWallet,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.claimSelector,
      blockTag,
    ),
    readContractWord(
      sourceRegistry.address,
      CUSTOM_V2_SELECTORS.sourceInterfaceId,
      blockTag,
    ),
  ]);

  if (
    decodeUint256(registrarChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeAddress(registrarSourceRegistry).toLowerCase() !==
      sourceRegistry.address.toLowerCase() ||
    decodeAddress(registrarCustomRegistry).toLowerCase() !==
      customRegistryV2.address.toLowerCase() ||
    decodeAddress(registrarLaunchStampRouter).toLowerCase() !==
      launchStampRouter.address.toLowerCase() ||
    decodeUint256(registryChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeUint256(registryGeneration) <
      CUSTOM_V2_POLICY.minimumRegistryGeneration ||
    decodeUint256(registryFinality) < CUSTOM_V2_POLICY.minimumFinalityBlocks ||
    decodeAddress(registrySourceRegistry).toLowerCase() !==
      sourceRegistry.address.toLowerCase() ||
    decodeUint256(launchStampChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeUint256(sourceChain) !== CUSTOM_V2_POLICY.chainId ||
    decodeUint256(sourceDelay) < CUSTOM_V2_POLICY.minimumFinalityBlocks ||
    !isTreasury(decodeAddress(sourceRewardWallet)) ||
    decodeBytes4(sourceClaimSelector) !== CUSTOM_V2_POLICY.claimSelector ||
    decodeBytes4(sourceInterfaceId) !== CUSTOM_V2_POLICY.sourceInterfaceId
  )
    throw new Error("Custom-V2-Infrastruktur-Bindung stimmt nicht");
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

async function readCustomV2Source(release, indexed, blockTag) {
  const sourceRegistry = release.contracts.sourceRegistry.address;
  const registrar = release.contracts.customRegistrar.address;
  const stateWord = await request("eth_call", [
    {
      to: sourceRegistry,
      data: customV2Bytes32ReadData(
        CUSTOM_V2_SELECTORS.sourceState,
        indexed.sourceId,
      ),
    },
    blockTag,
  ]);
  const source = decodeCustomV2SourceState(stateWord);
  const [
    executableWord,
    indexedLaunchWord,
    runtimeCode,
    recipientWord,
    accruedWord,
    totalClaimedWord,
    feeBpsWord,
  ] = await Promise.all([
    readContractWord(
      registrar,
      customV2Bytes32ReadData(
        CUSTOM_V2_SELECTORS.isFinalizedExecutable,
        indexed.launchId,
      ),
      blockTag,
    ),
    readContractWord(
      registrar,
      customV2Bytes32ReadData(
        CUSTOM_V2_SELECTORS.launchIdForSource,
        indexed.sourceId,
      ),
      blockTag,
    ),
    request("eth_getCode", [source.source, blockTag]),
    readContractWord(
      source.source,
      CUSTOM_V2_SELECTORS.programmableFeeRecipient,
      blockTag,
    ),
    readContractWord(source.source, readAccruedData({ kind: "custom" }), blockTag),
    readContractWord(
      source.source,
      `${CUSTOM_V2_SELECTORS.totalProgrammableFeesClaimed}${"0".repeat(64)}`,
      blockTag,
    ),
    readContractWord(
      source.source,
      `${CUSTOM_V2_SELECTORS.programmableFeeBps}${"0".repeat(64)}`,
      blockTag,
    ),
  ]);

  const executable = decodeBool(executableWord);
  const amount = decodeUint256(accruedWord);
  const bindingVerified =
    source.sourceId === indexed.sourceId &&
    decodeBytes32(indexedLaunchWord) === indexed.launchId &&
    source.registered &&
    source.asset.toLowerCase() === CUSTOM_V2_POLICY.nativeAsset &&
    source.claimSelector === CUSTOM_V2_POLICY.claimSelector &&
    isTreasury(source.recipient) &&
    source.activationBlock <= BigInt(blockTag) &&
    keccak256Hex(runtimeCode).toLowerCase() === source.runtimeCodeHash &&
    isTreasury(decodeAddress(recipientWord)) &&
    decodeUint256(feeBpsWord) === CUSTOM_V2_POLICY.programmableFeeBps;

  return Object.freeze({
    id: `custom-v2:${indexed.sourceId}`,
    hookId: "custom-v2",
    index: indexed.index,
    launchId: indexed.launchId,
    sourceId: indexed.sourceId,
    name: "Custom V2",
    detail: shortAddress(source.source),
    unit: "ETH",
    decimals: 18,
    kind: "custom",
    address: source.source,
    asset: CUSTOM_V2_POLICY.nativeAsset,
    runtimeCodeHash: source.runtimeCodeHash,
    activationBlock: source.activationBlock,
    registered: source.registered,
    quarantined: source.quarantined,
    executable,
    bindingVerified,
    amount,
    totalClaimed: decodeUint256(totalClaimedWord),
    recipientMatches: bindingVerified,
    status: bindingVerified ? "ready" : "failed",
  });
}

async function readCustomV2(blockTag) {
  for (const key of state.claims.keys()) {
    if (key.startsWith("custom-v2:")) state.claims.delete(key);
  }
  state.customV2 = {
    status: "loading",
    release: null,
    sources: [],
    error: null,
  };
  renderSummary();
  try {
    const response = await fetch(
      `${CUSTOM_V2_RELEASE_PATH}?block=${BigInt(blockTag).toString()}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("Custom-V2-Release-Datei fehlt");
    const release = parseCustomV2Release(await response.json());
    if (!release.active) {
      state.customV2 = {
        status: "hold",
        release,
        sources: [],
        error: null,
      };
      return;
    }

    await verifyCustomV2Infrastructure(release, blockTag);
    const count = decodeUint256(
      await readContractWord(
        release.contracts.customRegistrar.address,
        CUSTOM_V2_SELECTORS.finalizedSourceCount,
        blockTag,
      ),
    );
    if (count > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Custom-V2-Source-Liste ist zu groß");
    const indices = Array.from({ length: Number(count) }, (_, index) => index);
    const indexed = await mapWithConcurrency(indices, 24, async (index) => {
      const [sourceIdWord, launchIdWord] = await Promise.all([
        readContractWord(
          release.contracts.customRegistrar.address,
          customV2IndexedReadData(
            CUSTOM_V2_SELECTORS.finalizedSourceIdAt,
            BigInt(index),
          ),
          blockTag,
        ),
        readContractWord(
          release.contracts.customRegistrar.address,
          customV2IndexedReadData(
            CUSTOM_V2_SELECTORS.finalizedLaunchIdAt,
            BigInt(index),
          ),
          blockTag,
        ),
      ]);
      return {
        index,
        sourceId: decodeBytes32(sourceIdWord),
        launchId: decodeBytes32(launchIdWord),
      };
    });
    if (
      new Set(indexed.map(({ sourceId }) => sourceId)).size !== indexed.length ||
      new Set(indexed.map(({ launchId }) => launchId)).size !== indexed.length
    )
      throw new Error("Custom-V2-Registrar enthält doppelte Einträge");
    const sources = await mapWithConcurrency(indexed, 12, (entry) =>
      readCustomV2Source(release, entry, blockTag),
    );
    for (const source of sources)
      state.claims.set(source.id, {
        amount: source.amount,
        recipientMatches: source.recipientMatches,
        status: source.status,
      });
    state.customV2 = {
      status: "ready",
      release,
      sources,
      error: null,
    };
  } catch (error) {
    state.customV2 = {
      status: "failed",
      release: null,
      sources: [],
      error:
        error instanceof Error
          ? error.message
          : "Custom V2 konnte nicht gelesen werden",
    };
  }
}

async function readHook(hook, blockTag) {
  const [code, recipientWord] = await Promise.all([
    request("eth_getCode", [hook.address, blockTag]),
    request("eth_call", [
      { to: hook.address, data: SELECTORS.launcherFeeRecipient },
      blockTag,
    ]),
  ]);
  const actualCodeHash = keccak256Hex(code);
  const recipient = decodeAddress(recipientWord);
  return {
    actualCodeHash,
    recipient,
    verified:
      actualCodeHash.toLowerCase() === hook.runtimeCodeHash.toLowerCase() &&
      isTreasury(recipient),
  };
}

async function readClaim(claim, blockTag) {
  const amountWord = await request("eth_call", [
    { to: claim.address, data: readAccruedData(claim) },
    blockTag,
  ]);
  const hook = state.hooks.get(claim.hookId);
  return {
    amount: decodeUint256(amountWord),
    recipient: hook?.recipient,
    recipientMatches: hook?.verified === true,
    status: "ready",
  };
}

async function readCapabilities() {
  if (!state.account || state.chainId !== MAINNET_CHAIN_ID) {
    state.capability = null;
    state.capabilityStatus = "idle";
    return;
  }
  state.capabilityStatus = "loading";
  try {
    const capabilities = await request("wallet_getCapabilities", [
      state.account,
      [MAINNET_CHAIN_ID],
    ]);
    state.capability = atomicCapabilityStatus(capabilities);
    state.capabilityStatus = state.capability ? "ready" : "unsupported";
  } catch {
    state.capability = null;
    state.capabilityStatus = "failed";
  }
}

async function verifyCanonicalConfirmedBatchReceipts(receipts) {
  await Promise.all(
    receipts.map(async (storedReceipt) => {
      const proof = {
        blockNumber: BigInt(storedReceipt.blockNumber),
        blockHash: storedReceipt.blockHash,
        transactionHash: storedReceipt.transactionHash,
      };
      const [checkpoint, rpcReceipts] = await Promise.all([
        readRouterQuorumBlock(toQuantityHex(proof.blockNumber)),
        routerQuorumRequest("eth_getTransactionReceipt", [
          proof.transactionHash,
        ]),
      ]);
      if (
        checkpoint.number !== proof.blockNumber ||
        checkpoint.hash.toLowerCase() !== proof.blockHash.toLowerCase() ||
        rpcReceipts.length !== 3 ||
        rpcReceipts.some(
          (receipt) => !confirmedTransactionReceiptMatches(proof, receipt),
        )
      ) {
        throw new Error(
          "Der bestätigte Claim-Receipt ist noch nicht kanonisch finalisiert",
        );
      }
    }),
  );
}

async function reconcileConfirmedBatchLock() {
  return withAvailableClaimStateLease(async () => {
    let lock = loadConfirmedBatchLock();
    state.confirmedBatch = lock;
    if (
      !lock ||
      lock.invalid ||
      !state.account ||
      state.chainId !== MAINNET_CHAIN_ID ||
      state.account.toLowerCase() !== lock.account ||
      lock.phase === "manual"
    ) {
      return;
    }

    if (lock.phase !== "confirmed") {
      let result;
      try {
        result = await request("wallet_getCallsStatus", [lock.batchId]);
      } catch {
        return;
      }

      let status;
      try {
        status = validatedAtomicBatchStatus(
          result,
          lock.batchId,
          MAINNET_CHAIN_ID,
        );
      } catch {
        return;
      }

      if (status === 400 || status === 500) {
        clearConfirmedBatchLock(lock.batchId);
        return;
      }
      if (status >= 600) {
        saveConfirmedBatchLock(
          {
            ...lock,
            phase: "manual",
            failureStatus: status,
          },
          { expectedBatchId: lock.batchId },
        );
        return;
      }
      if (status !== 200) {
        if (status >= 100 && status < 200)
          saveConfirmedBatchLock(
            { ...lock, phase: "pending" },
            { expectedBatchId: lock.batchId },
          );
        return;
      }

      try {
        const proof = confirmedBatchReceiptProof(
          result,
          lock.batchId,
          MAINNET_CHAIN_ID,
        );
        lock = {
          ...lock,
          phase: "confirmed",
          receipts: proof.receipts.map((receipt) => ({
            blockNumber: receipt.blockNumber.toString(),
            blockHash: receipt.blockHash,
            transactionHash: receipt.transactionHash,
          })),
          failureStatus: null,
        };
        if (
          !saveConfirmedBatchLock(lock, {
            expectedBatchId: lock.batchId,
          })
        )
          return;
      } catch {
        return;
      }
    }

    const highestBlock = highestConfirmedReceiptBlock(lock);
    let inventoryBlock = null;
    try {
      inventoryBlock = BigInt(state.blockTag);
    } catch {
      // The fee inventory is not bound to a usable post-receipt checkpoint.
    }
    if (
      highestBlock === null ||
      inventoryBlock === null ||
      inventoryBlock < highestBlock ||
      state.router.status !== "ready" ||
      state.router.verified !== true ||
      typeof state.router.finalizedBlock !== "bigint" ||
      state.router.finalizedBlock < highestBlock
    ) {
      return;
    }

    try {
      await verifyCanonicalConfirmedBatchReceipts(lock.receipts);
      clearConfirmedBatchLock(lock.batchId);
    } catch {
      // A reorged, missing or divergent receipt remains locked until a later scan.
    }
  });
}

async function refreshClaimsOnce() {
  if (!state.account || state.chainId !== MAINNET_CHAIN_ID) return;
  state.scanInProgress = true;
  setError();
  setDetailedError();
  setStatus("Fees werden geprüft");
  renderSummary();
  try {
    await readLaunchStampRouter();
    const blockTag =
      state.router.status === "ready" &&
      state.router.verified === true &&
      typeof state.router.finalizedBlock === "bigint"
        ? toQuantityHex(state.router.finalizedBlock)
        : await request("eth_blockNumber");
    state.blockTag = blockTag;

    await Promise.all([
      readCustomRegistry(blockTag),
      readCustomV2(blockTag),
      readClassicLaunches(blockTag),
    ]);

    const hookResults = await mapWithConcurrency(HOOKS, 4, async (hook) => {
      try {
        return { status: "fulfilled", value: await readHook(hook, blockTag) };
      } catch (reason) {
        return { status: "rejected", reason };
      }
    });
    hookResults.forEach((result, index) => {
      const hook = HOOKS[index];
      state.hooks.set(
        hook.id,
        result.status === "fulfilled" ? result.value : { verified: false },
      );
    });

    const claimResults = await mapWithConcurrency(CLAIMS, 4, async (claim) => {
      try {
        return { status: "fulfilled", value: await readClaim(claim, blockTag) };
      } catch (reason) {
        return { status: "rejected", reason };
      }
    });
    claimResults.forEach((result, index) => {
      const claim = CLAIMS[index];
      state.claims.set(
        claim.id,
        result.status === "fulfilled"
          ? result.value
          : { amount: 0n, recipientMatches: false, status: "failed" },
      );
    });

    await readCapabilities();
    await reconcileConfirmedBatchLock();
    const verified = hookResults.filter(
      ({ status }, index) =>
        status === "fulfilled" && state.hooks.get(HOOKS[index].id)?.verified,
    ).length;
    const failedClaims = claimResults.filter(
      ({ status }) => status === "rejected",
    ).length;
    const errors = [];
    if (verified !== HOOKS.length)
      errors.push(
        "Mindestens eine Contract-Bindung stimmt nicht. Claims bleiben gesperrt.",
      );
    if (state.custom.error)
      errors.push(
        "Die Custom Registry konnte nicht vollständig verifiziert werden. Claims bleiben gesperrt.",
      );
    if (state.customV2.error)
      errors.push(
        "Das aktive Custom-V2-Release konnte nicht vollständig verifiziert werden. Claims bleiben gesperrt.",
      );
    if (state.classic.error)
      errors.push(
        "Die Classic-Launchliste konnte nicht vollständig gelesen werden. Claims bleiben gesperrt.",
      );
    if (state.router.error)
      errors.push(
        "Der offizielle Launch-Stamp-Router konnte nicht vollständig verifiziert werden. Alle Claims bleiben gesperrt.",
      );
    setDetailedError(errors.join(" "));
    setError(
      errors.length > 0
        ? "Nicht alle Gebührenquellen konnten geprüft werden. Erneut versuchen."
        : "",
    );
    if (
      !state.confirmedBatch &&
      errors.length === 0 &&
      failedClaims === 0 &&
      !scanNeedsRetry(verified)
    )
      saveCurrentScanSnapshot(blockTag);
    setStatus(
      state.confirmedBatch
        ? confirmedBatchStatus()
        : errors.length > 0
          ? "Prüfung unvollständig"
          : failedClaims === 0
            ? `Aktuell · Block ${BigInt(blockTag).toString()}`
            : `${failedClaims} Guthaben konnten nicht gelesen werden`,
    );
  } catch (error) {
    setStatus("Prüfung unvollständig");
    throw error;
  } finally {
    state.scanInProgress = false;
    renderSummary();
  }
}

const refreshClaims = createRefreshQueue(refreshClaimsOnce);

async function syncWallet({
  requestAccounts = false,
  expectedRevision = walletAuthorizationRevision,
} = {}) {
  const syncOperation = walletSyncGuard.begin();
  const method = requestAccounts ? "eth_requestAccounts" : "eth_accounts";
  let accounts;
  let chainId;
  try {
    [accounts, chainId] = await Promise.all([
      request(method),
      request("eth_chainId"),
    ]);
  } catch (error) {
    if (
      expectedRevision !== walletAuthorizationRevision ||
      !syncOperation.isCurrent()
    )
      return false;
    throw error;
  }
  if (
    expectedRevision !== walletAuthorizationRevision ||
    !syncOperation.isCurrent()
  )
    return false;
  state.account = Array.isArray(accounts) ? accounts[0] ?? null : null;
  state.chainId = chainId;
  renderSummary();
  if (requestAccounts && state.account) {
    setStatus(
      isTreasury(state.account)
        ? "Wallet verbunden · Fees werden gesucht"
        : "Reward Wallet auswählen",
    );
  }
  if (
    !state.account ||
    state.chainId !== MAINNET_CHAIN_ID ||
    !isTreasury(state.account)
  )
    return true;
  try {
    await refreshClaims();
  } catch (error) {
    setError("Fees konnten nicht aktualisiert werden. Erneut versuchen.");
    setDetailedError(
      error instanceof Error ? error.message : "Fee-Prüfung fehlgeschlagen",
    );
    setStatus("Reward Wallet bleibt verbunden");
    renderSummary();
  }
  return true;
}

async function chooseRewardWallet() {
  setStatus("Reward Wallet in MetaMask auswählen");
  await request("wallet_requestPermissions", [{ eth_accounts: {} }]);
  await syncWallet();
}

async function requireActiveRewardWallet(expectedAccount = null) {
  const revision = walletAuthorizationRevision;
  const [accounts, chainId] = await Promise.all([
    request("eth_accounts"),
    request("eth_chainId"),
  ]);
  if (revision !== walletAuthorizationRevision)
    throw new Error(
      "Wallet oder Netzwerk wurde während der Prüfung geändert. Es wurde nichts gesendet.",
    );
  const activeAccount = Array.isArray(accounts) ? accounts[0] ?? null : null;
  state.account = activeAccount;
  state.chainId = chainId;
  renderSummary();
  if (
    chainId !== MAINNET_CHAIN_ID ||
    !activeAccount ||
    !isTreasury(activeAccount) ||
    (expectedAccount !== null &&
      activeAccount.toLowerCase() !== expectedAccount.toLowerCase())
  )
    throw new Error(
      "Aktive Reward Wallet oder Netzwerk hat sich geändert. Es wurde nichts gesendet.",
    );
  return activeAccount.toLowerCase();
}

async function switchToMainnet() {
  await request("wallet_switchEthereumChain", [{ chainId: MAINNET_CHAIN_ID }]);
  await syncWallet();
  if (!state.account || !isTreasury(state.account))
    setStatus("Reward Wallet auswählen");
}

async function waitForBatch(initialLock) {
  let lock = initialLock;
  const id = lock.batchId;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5 * 60 * 1000) {
    let result;
    try {
      result = await request("wallet_getCallsStatus", [id]);
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      continue;
    }
    let status;
    try {
      status = validatedAtomicBatchStatus(result, id, MAINNET_CHAIN_ID);
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      continue;
    }
    if (status === 200) {
      const proof = confirmedBatchReceiptProof(result, id, MAINNET_CHAIN_ID);
      lock = {
        ...lock,
        phase: "confirmed",
        receipts: proof.receipts.map((receipt) => ({
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          transactionHash: receipt.transactionHash,
        })),
        failureStatus: null,
      };
      if (!saveConfirmedBatchLock(lock, { expectedBatchId: id }))
        throw new Error(
          "Der bestätigte Claim-Batch konnte nicht sicher gespeichert werden. Claims bleiben gesperrt.",
        );
      return lock;
    }
    if (status === 400 || status === 500) {
      clearConfirmedBatchLock(id);
      throw new Error("Der Claim-Batch wurde abgelehnt");
    }
    if (status >= 600) {
      lock = {
        ...lock,
        phase: "manual",
        failureStatus: status,
      };
      saveConfirmedBatchLock(lock, { expectedBatchId: id });
      throw new Error(
        "Der Wallet-Batch kann teilweise ausgeführt worden sein. Claims bleiben gesperrt.",
      );
    }
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
  throw new Error(
    "Der Batch ist noch offen. Vor einem neuen Versuch MetaMask prüfen.",
  );
}

async function submitStoredBatchAndWait(initialLock) {
  let lock = initialLock;
  const id = lock.batchId;
  try {
    const result = await request("wallet_sendCalls", [lock.batch]);
    const returnedId = normalizeBatchId(result);
    if (returnedId.toLowerCase() !== id.toLowerCase())
      throw new Error(
        "MetaMask hat eine abweichende Batch-ID geliefert. Claims bleiben gesperrt.",
      );
  } catch (error) {
    if (walletSendDefinitelyNotSubmitted(error)) {
      clearConfirmedBatchLock(id);
      throw error;
    }
    if (!walletSendDuplicateBatchId(error)) throw error;
  }

  lock = { ...lock, phase: "pending" };
  if (!saveConfirmedBatchLock(lock, { expectedBatchId: id }))
    throw new Error(
      "Der Claim-Batch konnte nach der Wallet-Antwort nicht sicher gespeichert werden. Claims bleiben gesperrt.",
    );
  return waitForBatch(lock);
}

async function preflightWalletBatch(batch) {
  await Promise.all(
    batch.calls.map(({ to, data, value }) =>
      request("eth_call", [
        { from: batch.from, to, data, value },
        "latest",
      ]),
    ),
  );
}

async function preflightClaimBatch(claims) {
  if (claims.length > MAX_BATCH_CALLS)
    throw new Error(
      `Mehr als ${MAX_BATCH_CALLS} offene Claims passen nicht sicher in einen atomaren Batch`,
    );
  const batch = buildWalletSendCalls(state.account, claims);
  await preflightWalletBatch(batch);
  return batch;
}

function walletCallKey({ to, data, value }) {
  return `${to.toLowerCase()}:${data.toLowerCase()}:${value.toLowerCase()}`;
}

async function walletRecognizesStoredBatch(lock) {
  try {
    const result = await request("wallet_getCallsStatus", [lock.batchId]);
    validatedAtomicBatchStatus(result, lock.batchId, MAINNET_CHAIN_ID);
    return true;
  } catch {
    return false;
  }
}

async function validateStoredBatchForResubmission(lock) {
  await refreshClaims();
  await requireActiveRewardWallet(lock.account);
  const safetyError = claimSafetyError({ ignoreConfirmedBatch: true });
  if (safetyError) throw new Error(`${safetyError}. Claims bleiben gesperrt.`);

  const currentClaims = claimableClaims({ ignoreConfirmedBatch: true });
  const currentCalls =
    currentClaims.length === 0
      ? []
      : buildWalletSendCalls(lock.account, currentClaims).calls;
  const currentCallKeys = new Set(currentCalls.map(walletCallKey));
  if (lock.batch.calls.some((call) => !currentCallKeys.has(walletCallKey(call))))
    throw new Error(
      "Der gespeicherte Claim ist nicht mehr Teil des aktuell verifizierten Fee-Inventars. Es wurde nichts gesendet.",
    );

  await preflightWalletBatch(lock.batch);
  await requireActiveRewardWallet(lock.account);
}

async function claimAll() {
  const expectedAccount = await requireActiveRewardWallet();
  await refreshClaims();
  await requireActiveRewardWallet(expectedAccount);
  const safetyError = claimSafetyError();
  if (safetyError) throw new Error(`${safetyError}. Claims bleiben gesperrt.`);
  const claims = claimableClaims();
  if (claims.length === 0) return;
  requireAtomicClaimCapability(state.capability);
  state.busy = true;
  setError();
  renderSummary();

  try {
    await withExclusiveClaimLease(async () => {
      setStatus(
        `${claims.length} Claims werden direkt vor MetaMask erneut simuliert`,
      );
      const batch = await preflightClaimBatch(claims);
      await requireActiveRewardWallet(expectedAccount);
      requireConfirmedBatchStorage();
      const id = createAppBatchId();
      const exactBatch = { ...batch, id };
      const submissionLock = {
        schema: CONFIRMED_BATCH_SCHEMA,
        account: expectedAccount,
        chainId: MAINNET_CHAIN_ID,
        batchId: id,
        batch: exactBatch,
        phase: "submitting",
        receipts: null,
        failureStatus: null,
      };
      if (!saveConfirmedBatchLock(submissionLock, { requireEmpty: true }))
        throw new Error(
          "Die tabübergreifende Claim-Sperre konnte nicht gespeichert werden. Es wurde nichts gesendet.",
        );
      setStatus(
        `${claims.length} Claims werden in einer MetaMask-Bestätigung vorbereitet`,
      );
      return submitStoredBatchAndWait(submissionLock);
    });
    setStatus("Die ausgewählten geprüften Fees wurden geclaimt");
    await refreshClaims();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Der Claim konnte nicht abgeschlossen werden";
    setError(
      /reject|denied|cancel/i.test(message)
        ? "Claim in MetaMask abgebrochen"
        : message,
    );
    setStatus("Claims wurden sicher gestoppt");
  } finally {
    state.busy = false;
    renderSummary();
  }
}

async function resumeStoredBatch() {
  state.busy = true;
  setError();
  renderSummary();
  try {
    await withExistingClaimLease(async (lock) => {
      if (!["submitting", "pending"].includes(lock.phase))
        throw new Error("Dieser Claim-Batch kann nicht erneut eingereicht werden");
      await requireActiveRewardWallet(lock.account);
      if (lock.phase === "pending" || (await walletRecognizesStoredBatch(lock)))
        return waitForBatch(lock);
      await validateStoredBatchForResubmission(lock);
      setStatus("Der gespeicherte Claim-Batch wird mit derselben ID fortgesetzt");
      return submitStoredBatchAndWait(lock);
    });
    setStatus("Die ausgewählten geprüften Fees wurden geclaimt");
    await refreshClaims();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Der gespeicherte Claim-Batch konnte nicht fortgesetzt werden";
    setError(
      /reject|denied|cancel/i.test(message)
        ? "Claim in MetaMask abgebrochen"
        : message,
    );
    setStatus("Claims wurden sicher gestoppt");
  } finally {
    state.busy = false;
    renderSummary();
  }
}

async function handlePrimaryAction() {
  try {
    setError();
    if (DEMO_MODE) {
      setStatus(
        "QA-Vorschau: In der echten Ansicht öffnet dieser Button genau eine MetaMask-Bestätigung",
      );
      return;
    }
    state.busy = true;
    renderSummary();
    if (!state.account) await syncWallet({ requestAccounts: true });
    else if (state.chainId !== MAINNET_CHAIN_ID) await switchToMainnet();
    else if (!isTreasury(state.account)) await chooseRewardWallet();
    else if (isTreasury(state.account)) {
      if (
        state.confirmedBatch &&
        !state.confirmedBatch.invalid &&
        ["submitting", "pending"].includes(state.confirmedBatch.phase)
      )
        await resumeStoredBatch();
      else {
        const verifiedHooks = HOOKS.filter(
          ({ id }) => state.hooks.get(id)?.verified === true,
        ).length;
        if (
          scanNeedsRetry(verifiedHooks) ||
          claimableClaims().length === 0 ||
          state.capabilityStatus === "failed"
        )
          await refreshClaims();
        else await claimAll();
      }
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Wallet-Verbindung fehlgeschlagen";
    setError(
      /reject|denied|cancel/i.test(message)
        ? "Aktion in MetaMask abgebrochen"
        : message,
    );
  } finally {
    state.busy = false;
    renderSummary();
  }
}

window.addEventListener("storage", (event) => {
  if (DEMO_MODE || event.key !== CONFIRMED_BATCH_STORAGE_KEY) return;
  const stored = loadConfirmedBatchLock();
  if (stored) {
    state.confirmedBatch = stored;
    renderSummary();
    return;
  }
  state.confirmedBatch = null;
  state.busy = true;
  renderSummary();
  refreshClaims()
    .catch(() => undefined)
    .finally(() => {
      state.busy = false;
      renderSummary();
    });
});

let lastPassiveWalletSyncAt = 0;
let passiveWalletSyncTimer = null;
let forceNextPassiveWalletSync = false;

async function passiveWalletSync({ force = false } = {}) {
  if (
    DEMO_MODE ||
    state.busy ||
    state.scanInProgress ||
    document.visibilityState === "hidden"
  )
    return;
  const now = Date.now();
  if (!force && now - lastPassiveWalletSyncAt < AUTO_REFRESH_AFTER_MS) return;
  const synchronized = await syncWallet();
  if (synchronized) lastPassiveWalletSyncAt = Date.now();
}

function schedulePassiveWalletSync({ force = false } = {}) {
  if (DEMO_MODE) return;
  forceNextPassiveWalletSync ||= force;
  if (passiveWalletSyncTimer !== null) return;
  passiveWalletSyncTimer = window.setTimeout(() => {
    passiveWalletSyncTimer = null;
    const forceSync = forceNextPassiveWalletSync;
    forceNextPassiveWalletSync = false;
    passiveWalletSync({ force: forceSync }).catch(() => undefined);
  }, 250);
}

window.addEventListener("eip6963:announceProvider", () =>
  schedulePassiveWalletSync({ force: true }),
);
window.addEventListener("focus", () => schedulePassiveWalletSync());
window.addEventListener("pageshow", () => schedulePassiveWalletSync());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") schedulePassiveWalletSync();
});

elements.action.addEventListener("click", handlePrimaryAction);

function seedDemoState() {
  state.account = TREASURY;
  state.chainId = MAINNET_CHAIN_ID;
  state.blockTag = "0x189f510";
  state.capability = "ready";
  state.capabilityStatus = "ready";
  for (const hook of HOOKS) {
    state.hooks.set(hook.id, {
      actualCodeHash: hook.runtimeCodeHash,
      recipient: TREASURY,
      verified: true,
    });
  }
  const demoAmounts = new Map([
    ["classic-v3", 3_831_314_566_506_772n],
    ["classic-v2", 227_307_871_565_013_620n],
    ["classic-v1", 46_446_511_178_969n],
    ["stock-current-nvdaon", 84_200_000_000_000_000n],
  ]);
  for (const claim of CLAIMS) {
    state.claims.set(claim.id, {
      amount: demoAmounts.get(claim.id) ?? 0n,
      recipient: TREASURY,
      recipientMatches: true,
      status: "ready",
    });
  }
  state.custom = {
    status: "retired",
    registryVerified: true,
    launches: [],
    error: null,
  };
  state.customV2 = {
    status: "hold",
    release: null,
    sources: [],
    error: null,
  };
  state.classic = {
    status: "ready",
    launchersVerified: true,
    launches: [],
    error: null,
  };
  const fadeProfile = ROUTER_CUSTOM_CLAIM_PROFILES.nativeAccumulatorV1;
  const fadeBinding = fadeProfile.bindings[0];
  const fadeClaim = {
    id: `router-custom:${fadeBinding.launchId}`,
    launchId: fadeBinding.launchId,
    token: "0x69d278968abf120f878f2e1e016ab615d3686c19",
    hook: fadeBinding.source,
    runtimeCodeHash: fadeBinding.runtimeCodeHash,
    launchKind: 1,
    kind: "custom",
    origin: "launch-stamp-router",
    address: fadeBinding.source,
    unit: "ETH",
    decimals: 18,
    provenanceVerified: true,
    runtimeVerified: true,
    claimMode: "manual",
    claimProfile: fadeProfile.id,
    readData: fadeProfile.accrued,
    claimData: fadeProfile.claim,
    claimBindingVerified: true,
    recipientMatches: true,
    amount: 28_054_452_170_132_560n,
    status: "ready",
  };
  const pcanProfile = ROUTER_CUSTOM_CLAIM_PROFILES.dualCurrencyRedeemerV1;
  const pcanBinding = pcanProfile.bindings[0];
  const pcanClaim = {
    id: `router-custom:${pcanBinding.launchId}`,
    launchId: pcanBinding.launchId,
    token: "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce",
    hook: pcanBinding.source,
    runtimeCodeHash: pcanBinding.runtimeCodeHash,
    launchKind: 1,
    kind: "custom",
    origin: "launch-stamp-router",
    address: pcanBinding.source,
    unit: "ETH",
    decimals: 18,
    provenanceVerified: true,
    runtimeVerified: true,
    claimMode: "manual",
    claimProfile: pcanProfile.id,
    claimData: pcanProfile.claim,
    claimBindingVerified: true,
    recipientMatches: true,
    amount: 500_802_908_283_517n,
    secondaryAsset: "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce",
    secondaryAmount: 2_740_004_896_936_423_458_238n,
    secondaryUnit: pcanProfile.secondaryUnit,
    secondaryDecimals: pcanProfile.secondaryDecimals,
    status: "ready",
  };
  state.router = {
    status: "ready",
    verified: true,
    finalizedBlock: 25_827_076n,
    launches: [fadeClaim, pcanClaim],
    error: null,
  };
  state.claims.set(fadeClaim.id, {
    amount: fadeClaim.amount,
    recipientMatches: true,
    status: "ready",
  });
  state.claims.set(pcanClaim.id, {
    amount: pcanClaim.amount,
    secondaryAmount: pcanClaim.secondaryAmount,
    recipientMatches: true,
    status: "ready",
  });
  renderSummary();
  elements.status.textContent =
    "Sichere QA-Vorschau · Werte sind Testdaten · keine Wallet-Aktion";
}

if (DEMO_MODE) {
  seedDemoState();
} else {
  renderSummary();
  passiveWalletSync({ force: true }).catch(() => {
    setStatus("MetaMask verbinden");
    renderSummary();
  });
}
