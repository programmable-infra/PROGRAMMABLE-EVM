export const TREASURY = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";

export const MAINNET_CHAIN_ID = "0x1";

export const SELECTORS = Object.freeze({
  launcherFeesAccrued: "0x1497233e",
  launcherAssetFeesAccrued: "0x31b8ca96",
  launcherFeeRecipient: "0x4c50e2c4",
  claimLauncherFees: "0x64d46b85",
  claimLauncherAssetFees: "0xaee8cd6f",
  customRegistrationCount: "0x0d3eafd6",
  customLaunchState: "0x2b76b49c",
});

export const CUSTOM_V2_SELECTORS = Object.freeze({
  finalizedSourceCount: "0xf8ec37a7",
  finalizedLaunchIdAt: "0xcb2235c0",
  finalizedSourceIdAt: "0xf5f62028",
  isFinalizedExecutable: "0xcb2b7132",
  launchIdForSource: "0x3eeacd13",
  sourceState: "0x447c24c0",
  sourceRegistry: "0xee9ab677",
  customRegistryV2: "0xab0adbf2",
  launchStampRouter: "0xa87eb510",
  supportedChainId: "0x356c6567",
  chainId: "0x85e1f4d0",
  registryGeneration: "0x8ca2d907",
  minimumFinalityBlocks: "0x03580b1c",
  minimumActivationDelayBlocks: "0x92636c45",
  rewardWallet: "0xb66ceef6",
  claimSelector: "0x7011b80b",
  sourceInterfaceId: "0x1b11e61b",
  programmableFeeRecipient: "0x424ff2a5",
  accruedProgrammableFees: "0x3129853d",
  totalProgrammableFeesClaimed: "0x4a383b32",
  programmableFeeBps: "0x32c0314d",
  claimProgrammableFees: "0xb9d2fad0",
});

export const CUSTOM_V2_POLICY = Object.freeze({
  schemaVersion: "programmable.custom-claim-console.release.v1",
  chainId: 1n,
  minimumRegistryGeneration: 2n,
  minimumFinalityBlocks: 64n,
  nativeAsset: "0x0000000000000000000000000000000000000000",
  recipient: TREASURY,
  programmableFeeBps: 10n,
  claimSelector: CUSTOM_V2_SELECTORS.claimProgrammableFees,
  sourceInterfaceId: "0x808cb67a",
});

export const CUSTOM_V2_RELEASE_PATH = "./custom-v2-release.json";

export const LAUNCH_STAMP_ROUTER = Object.freeze({
  address: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
  startBlock: 25_717_612n,
  endBlock: null,
  finalizedTag: "finalized",
  maximumFinalizedSpread: 32n,
  runtimeCodeHash:
    "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
  sourceCommit: "0a7134bbb912222639627fb9078df2f8dd3a6c38",
  sourceTree: "24ffb0c6b04af7993254560b4f03608de8f52231",
  abiSha256:
    "sha256:bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86",
  permitAuthority: Object.freeze({
    address: "0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b",
    runtimeCodeHash:
      "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  }),
  graphFactory: Object.freeze({
    address: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
    runtimeCodeHash:
      "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  }),
  poolManager: Object.freeze({
    address: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    runtimeCodeHash:
      "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
  }),
});

export const LAUNCH_STAMP_TOPICS = Object.freeze({
  launchStamped:
    "0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2",
  launchRouteStamped:
    "0x45e7cc355b63ca67d6278a0d8d23470ce2a0741a9c60283d7dee712df7a877a5",
  componentStamped:
    "0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b",
});

export const LAUNCH_STAMP_SELECTORS = Object.freeze({
  chainId: "0x85e1f4d0",
  permitAuthority: "0xc3a3d03c",
  permitAuthorityRuntimeCodeHash: "0xa497c61c",
  graphFactory: "0x1cc9e5ce",
  graphFactoryRuntimeCodeHash: "0x92989a00",
  poolManager: "0x62308e85",
  poolManagerRuntimeCodeHash: "0x38d831c4",
  launchIdByToken: "0x1dad847c",
  launchIdByPool: "0x361df6f3",
  launchIdByComponent: "0x58c5e373",
  componentRuntimeCodeHash: "0xc892d353",
  launchStamp: "0x4c9e4764",
  stampProof: "0x174b9f9d",
});

export const ROUTER_CUSTOM_CLAIM_PROFILES = Object.freeze({
  nativeAccumulatorV1: Object.freeze({
    id: "native-accumulator-v1",
    bindings: Object.freeze([
      Object.freeze({
        launchId:
          "0x6d6ed0e1e69a7cd6afa177e3454c9e32eed61cbd3f855ee56aff1915a6776fc2",
        source: "0xd7451a039373f54e493deE42A751fEcBfAFBa0cc",
        runtimeCodeHash:
          "0xff70a4d3d889b730a064b270fc187f0cba40582f1fa6f5875893066b17a1257b",
      }),
    ]),
    recipient: "0x4968150a",
    feeBps: "0xb6c7448d",
    accrued: "0x0986bdb6",
    claim: "0xa95e4f21",
    expectedFeeBps: 10n,
  }),
  shardLauncherFeesV1: Object.freeze({
    id: "shard-launcher-fees-v1",
    bindings: Object.freeze([
      Object.freeze({
        launchId:
          "0xe253f3bd22fcb3d6cb20b9d408287e30f0f1aeeb56426b779425c35fd6411de9",
        token: "0xFAce73B63787960282f2d4682d3752Beb25271Ad",
        source: "0x07a16735325723fEa4f4a52ED5E9da687766A0Cc",
        runtimeCodeHash:
          "0x168f82b0d458a35676522562489b2fec71929e4717c3d98b4893ef63e69e8da6",
      }),
    ]),
    recipient: "0x4c50e2c4",
    feeBps: "0x89223381",
    feeDenominatorBps: "0xe1a45218",
    poolManager: "0xdc4c90d3",
    boundToken: "0x996373c3",
    nft: "0x47ccca02",
    initialized: "0x07003bb4",
    accrued: "0x1497233e",
    claim: "0x64d46b85",
    expectedFeeBps: 1_000n,
    expectedFeeDenominatorBps: 10_000n,
    expectedNft: "0x92822e03D9cc1b2b497647B159ce5207Cd721527",
  }),
  protocolFeeSourceV1: Object.freeze({
    id: "protocol-fee-source-v1",
    bindings: Object.freeze([]),
    recipient: CUSTOM_V2_SELECTORS.programmableFeeRecipient,
    feeBps: `${CUSTOM_V2_SELECTORS.programmableFeeBps}${"0".repeat(64)}`,
    accrued: `${CUSTOM_V2_SELECTORS.accruedProgrammableFees}${"0".repeat(64)}`,
    claim: `${CUSTOM_V2_SELECTORS.claimProgrammableFees}${"0".repeat(64)}`,
    expectedFeeBps: 10n,
  }),
  isolatedAfterSwapFeeVaultV2: Object.freeze({
    id: "isolated-after-swap-fee-vault-v2",
    bindings: Object.freeze([
      Object.freeze({
        launchId:
          "0x786d3d5cdd0c6ba81621eb01fbcc6b5912556a2d7dbe886431346460afeee197",
        token: "0xD0f3E1e5C985D2b37a66Cf07feCB0d8191c0445F",
        hook: "0xce6f22c5ccf06aad50dd2bc681fa7c30ce55e044",
        hookRuntimeCodeHash:
          "0x0a461fa65d04305fa2e583d9a6fba369b3b2ff66aa5856f56d0782c2ff72e19c",
        source: "0x97875d30DFE562e290Eb5646D907F8e775645f66",
        sourceRuntimeCodeHash:
          "0xf2cbc21a3f07c05909d664ba8d8b66fe6576eb8a5d016faa53e31e73ed6acbd4",
      }),
    ]),
    hookFeeVault: "0x5517476a",
    recipient: "0xc6fd9bd8",
    feePpm: "0x6cf9ca81",
    feeDenominatorPpm: "0x1bd7398b",
    poolManager: "0xdc4c90d3",
    authorizedAdapter: "0x54a1b628",
    authorizedAdapterCodeHash: "0x18903320",
    bindingAuthority: "0x2028d39b",
    accrued: "0x87d4d28c",
    claim: "0x5fa65a04",
    expectedFeePpm: 1_000n,
    expectedFeeDenominatorPpm: 1_000_000n,
    secondaryUnit: "PCR2",
    secondaryDecimals: 18,
  }),
  dualCurrencyRedeemerV1: Object.freeze({
    id: "dual-currency-redeemer-v1",
    bindings: Object.freeze([
      Object.freeze({
        launchId:
          "0x5a52180427785716bff0a36218dde89f0459db265d0c2bdfcfde81a8fe733c92",
        source: "0xEBa46F25dff528141DE5317109aCB5a989296044",
        runtimeCodeHash:
          "0xd59d31add7a3b206972725889dbb726782c0fbd82514710cf2d645749dc3fa25",
      }),
    ]),
    recipient: "0x46904840",
    feePips: "0x9fa59765",
    poolManager: "0xdc4c90d3",
    currency0: "0x79f1232b",
    currency1: "0x10d737b8",
    poolId: "0x3e0dc34e",
    balanceOf: "0x00fdd58e",
    claim:
      "0xfc656ac500000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000",
    expectedFeePips: 1_000n,
    secondaryUnit: "PCAN",
    secondaryDecimals: 18,
  }),
});

export const CUSTOM_REGISTRY = Object.freeze({
  status: "retired",
  address: "0x0000000000000000000000000000000000000000",
  startBlock: 0n,
  runtimeCodeHash: null,
});

export const CUSTOM_EVENT_TOPICS = Object.freeze({
  registered:
    "0x8ee074138114415a92a0797b4f1f4c6353f8bd15d8031433abf0cc42c2dc274a",
  provenance:
    "0x9593acf43b1c8e03c6742d49b67008f3c05841d3cfa43389d12f98e8b9c66cb9",
  feePolicy:
    "0xb889df8572071d751e87d3e2a46c54093a55a9bc5a4697440cd29c90255dc5bf",
  finalized:
    "0xab930c1c165bba36257b8079ae38b6869f604910f6ffa40c956e31eb1b8ce38f",
  revoked: "0x195a188d2c49d5e643afbcfd959edbf2ed1d6cd9216c5d99f3ad08c1010a9744",
});

export const CUSTOM_FEE_POLICY_KIND = Object.freeze({
  native: 0,
  partner: 1,
  noQualifyingMarket: 2,
});

export const CLASSIC_LAUNCHERS = Object.freeze([
  {
    id: "classic-v3",
    name: "Classic V3",
    address: "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770",
    startBlock: 25_639_596n,
    runtimeCodeHash:
      "0x9cc9723456c471d90ac838c02fa4fc47ed4b7e82c85358e71deec978c48d2dc8",
    eventTopic:
      "0xf23bd7fdf96caf9195ba5982de473632f59015abc714915dfbbe06cbd8e255e5",
    feeHook: "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC",
  },
  {
    id: "classic-v2",
    name: "Classic V2",
    address: "0xD240D06f8586eB799f20056054e5b527405E6bAd",
    startBlock: 25_624_131n,
    runtimeCodeHash:
      "0xd229555c79c61874549a1991c43df172104e1db3087ba8fca8804675b7440d36",
    eventTopic:
      "0x54f861f401872200b25acd4a9f53153ac06a7be4562b3e43025a4a85740a5675",
    feeHook: "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC",
  },
]);

export const TOKEN_SELECTORS = Object.freeze({
  name: "0x06fdde03",
  symbol: "0x95d89b41",
});

export const HOOKS = Object.freeze([
  {
    id: "classic-v4",
    name: "Classic V4",
    detail: "Aktuell",
    kind: "native",
    address: "0xADF955a44FD7F009380240d56D71dFAfB46020cc",
    runtimeCodeHash:
      "0xf3a1a628ce898c527f24569b426aa795ec65ff9d97afa2b89e8ea5a2b99ad280",
  },
  {
    id: "classic-v3",
    name: "Classic V3",
    detail: "Frühere Version",
    kind: "native",
    address: "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC",
    runtimeCodeHash:
      "0x3eba781023d3146ed9b502ac5b402d39cea4c34a14f64c878cb9ea62149590f1",
  },
  {
    id: "classic-v2",
    name: "Classic V2",
    detail: "Frühere Version",
    kind: "native",
    address: "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC",
    runtimeCodeHash:
      "0x274e29fb8d19f0607533ac7582827db0236ab546bb393d52049229b2ffe74381",
  },
  {
    id: "classic-v1",
    name: "Classic V1",
    detail: "Frühere Version",
    kind: "native",
    address: "0x48bB2672c7fd2a12e7fb5D46c441ccD3726520Cc",
    runtimeCodeHash:
      "0x60fd96af952730792036d43d806046675817a5a2de609d87c06203a8d6037650",
  },
  {
    id: "stock-current",
    name: "Stock V2/V3",
    detail: "Gemeinsamer Hook",
    kind: "asset",
    address: "0x90c67C1E866f86526F0e338459cD435E1F23A0cc",
    runtimeCodeHash:
      "0x3e292c9ddc64cc3a9c45f79d9d239ab2b8196f10efbdbc74b4f9b37dba53981d",
  },
  {
    id: "stock-v1",
    name: "Stock V1",
    detail: "Frühere Version",
    kind: "asset",
    address: "0x7773D183fe7B60d4F1885047fa42b815a62Fe0Cc",
    runtimeCodeHash:
      "0x4da04b13565c195132988b3b96e3c43b9f199c0324f18fee616f888b775a2230",
  },
]);

const CURRENT_STOCK_ASSETS = [
  ["NVDAon", "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE"],
  ["SPYon", "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08"],
  ["GOOGLon", "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc"],
  ["SLVon", "0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4"],
  ["TSLAon", "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f"],
  ["AAPLon", "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c"],
  ["BABAon", "0x41765F0FcddC276309195166C7A62ae522fa09ef"],
  ["COPXon", "0x423a63dfe8d82cd9c6568c92210aa537d8ef6885"],
  ["CRCLon", "0x3632DeA96a953C11dAc2f00b4A05A32cd1063FAe"],
  ["TLTon", "0x992651bfeb9A0dcc4457610e284BA66d86489D4d"],
  ["USOon", "0x1f5Fc5C3c8b0f15c7e21af623936fF2b210b6415"],
];

const LEGACY_STOCK_ASSETS = [
  ["NVDAon", "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE"],
  ["SPYon", "0xFeDC5f4a6c38211c1338aa411018DFAf26612c08"],
  ["GOOGLon", "0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc"],
  ["SLVon", "0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4"],
  ["QQQon", "0x0e397938C1Aa0680954093495B70A9F5e2249aBa"],
  ["TSLAon", "0xf6b1117ec07684D3958caD8BEb1b302bfD21103f"],
  ["AAPLon", "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c"],
];

function stockClaims(hookId, assets) {
  return assets.map(([unit, asset]) => ({
    id: `${hookId}-${unit.toLowerCase()}`,
    hookId,
    name: HOOKS.find(({ id }) => id === hookId)?.name ?? hookId,
    detail: unit,
    unit,
    decimals: 18,
    kind: "asset",
    address: HOOKS.find(({ id }) => id === hookId)?.address,
    asset,
  }));
}

export const CLAIMS = Object.freeze([
  ...HOOKS.filter(({ kind }) => kind === "native").map((hook) => ({
    id: hook.id,
    hookId: hook.id,
    name: hook.name,
    detail: hook.detail,
    unit: "ETH",
    decimals: 18,
    kind: "native",
    address: hook.address,
  })),
  ...stockClaims("stock-current", CURRENT_STOCK_ASSETS),
  ...stockClaims("stock-v1", LEGACY_STOCK_ASSETS),
]);

const MASK_64 = (1n << 64n) - 1n;
const ROTATIONS = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18,
  2, 61, 56, 14,
];
const ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

function rotateLeft64(value, shift) {
  if (shift === 0) return value & MASK_64;
  const bits = BigInt(shift);
  return ((value << bits) | (value >> (64n - bits))) & MASK_64;
}

function keccakPermutation(state) {
  for (const constant of ROUND_CONSTANTS) {
    const columns = Array(5).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) columns[x] ^= state[x + 5 * y];
    }

    for (let x = 0; x < 5; x += 1) {
      const delta =
        columns[(x + 4) % 5] ^ rotateLeft64(columns[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1)
        state[x + 5 * y] = (state[x + 5 * y] ^ delta) & MASK_64;
    }

    const moved = Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const index = x + 5 * y;
        moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotateLeft64(
          state[index],
          ROTATIONS[index],
        );
      }
    }

    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const index = x + 5 * y;
        state[index] =
          (moved[index] ^
            (~moved[((x + 1) % 5) + 5 * y] & moved[((x + 2) % 5) + 5 * y])) &
          MASK_64;
      }
    }
    state[0] ^= constant;
  }
}

function hexToBytes(value) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error("Ungültige Hex-Daten");
  }
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(
      value.slice(2 + index * 2, 4 + index * 2),
      16,
    );
  return bytes;
}

export function keccak256Hex(value) {
  const source = hexToBytes(value);
  const rate = 136;
  const paddedLength = Math.ceil((source.length + 1) / rate) * rate;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let index = 0; index < rate; index += 1) {
      state[Math.floor(index / 8)] ^=
        BigInt(padded[offset + index]) << BigInt((index % 8) * 8);
    }
    keccakPermutation(state);
  }

  let output = "0x";
  for (let index = 0; index < 32; index += 1) {
    const byte = Number(
      (state[Math.floor(index / 8)] >> BigInt((index % 8) * 8)) & 0xffn,
    );
    output += byte.toString(16).padStart(2, "0");
  }
  return output;
}

export function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export async function withTimeout(promise, timeoutMs, message) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("Ungültiges RPC-Zeitlimit");
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(message || "RPC-Zeitlimit überschritten")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function isTreasury(value) {
  return normalizeAddress(value) === normalizeAddress(TREASURY);
}

export function decodeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error("Ungültige Empfängeradresse");
  return `0x${value.slice(-40)}`;
}

export function decodeUint256(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value))
    throw new Error("Ungültiger Fee-Betrag");
  return BigInt(value);
}

export function decodeBool(value) {
  const decoded = decodeUint256(value);
  if (decoded !== 0n && decoded !== 1n)
    throw new Error("Ungültiger Boolean-Wert");
  return decoded === 1n;
}

export function decodeBytes4(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error("Ungültiger Selector");
  return `0x${value.slice(2, 10).toLowerCase()}`;
}

export function decodeBytes32(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error("Ungültiger bytes32-Wert");
  return value.toLowerCase();
}

function abiWord(data, index) {
  if (typeof data !== "string" || !/^0x(?:[0-9a-fA-F]{64})+$/.test(data))
    throw new Error("Ungültige Custom-Eventdaten");
  const start = 2 + index * 64;
  const word = data.slice(start, start + 64);
  if (word.length !== 64) throw new Error("Custom-Event ist unvollständig");
  return `0x${word}`;
}

function requireAbiWords(data, count, label) {
  if (
    typeof data !== "string" ||
    !/^0x[0-9a-fA-F]*$/.test(data) ||
    data.length !== 2 + count * 64
  )
    throw new Error(`${label} hat eine ungültige ABI-Länge`);
}

export function decodeAbiString(value) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value))
    throw new Error("Ungültiger Token-Text");
  const payload = value.slice(2);
  if (payload.length < 128) throw new Error("Token-Text ist unvollständig");
  const offset = Number(BigInt(`0x${payload.slice(0, 64)}`));
  if (!Number.isSafeInteger(offset) || offset % 32 !== 0)
    throw new Error("Token-Text hat einen ungültigen Offset");
  const lengthOffset = offset * 2;
  if (payload.length < lengthOffset + 64)
    throw new Error("Token-Text-Länge fehlt");
  const length = Number(
    BigInt(`0x${payload.slice(lengthOffset, lengthOffset + 64)}`),
  );
  if (!Number.isSafeInteger(length) || length > 256)
    throw new Error("Token-Text ist zu lang");
  const start = lengthOffset + 64;
  const end = start + length * 2;
  if (payload.length < end) throw new Error("Token-Text ist abgeschnitten");
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1)
    bytes[index] = Number.parseInt(
      payload.slice(start + index * 2, start + index * 2 + 2),
      16,
    );
  const decoded = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .trim();
  if (decoded.length === 0) throw new Error("Token-Text ist leer");
  return decoded;
}

export function decodeClassicLaunchLog(log, launcher) {
  if (!launcher || !CLASSIC_LAUNCHERS.some(({ id }) => id === launcher.id))
    throw new Error("Unbekannter Classic-Launcher");
  if (
    !log ||
    log.removed === true ||
    normalizeAddress(log.address) !== normalizeAddress(launcher.address) ||
    !Array.isArray(log.topics) ||
    log.topics.length !== 4 ||
    log.topics[0]?.toLowerCase() !== launcher.eventTopic
  )
    throw new Error("Classic-Launch-Event ist nicht kanonisch");
  const creator = topicAddress(log.topics[1]);
  const token = topicAddress(log.topics[2]);
  const poolId = log.topics[3]?.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(poolId ?? ""))
    throw new Error("Classic Pool-ID fehlt");
  const feeHook = wordAddress(abiWord(log.data, 0));
  if (normalizeAddress(feeHook) !== normalizeAddress(launcher.feeHook))
    throw new Error("Classic Fee-Hook stimmt nicht");
  return {
    id: `${launcher.id}:${poolId}`,
    releaseId: launcher.id,
    releaseName: launcher.name,
    creator,
    token,
    poolId,
    feeHook,
    blockNumber: BigInt(log.blockNumber),
    logIndex: BigInt(log.logIndex),
    transactionHash: log.transactionHash?.toLowerCase(),
  };
}

export function reduceClassicLaunchLogs(entries) {
  if (!Array.isArray(entries)) throw new Error("Classic-Events fehlen");
  const launches = new Map();
  for (const entry of entries) {
    const launch = decodeClassicLaunchLog(entry.log, entry.launcher);
    if (launches.has(launch.id)) throw new Error("Doppelter Classic-Launch");
    launches.set(launch.id, launch);
  }
  return [...launches.values()].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber)
      return left.blockNumber > right.blockNumber ? -1 : 1;
    if (left.logIndex !== right.logIndex)
      return left.logIndex > right.logIndex ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}

export function decodeLaunchStampLog(log) {
  if (
    !log ||
    log.removed === true ||
    normalizeAddress(log.address) !== normalizeAddress(LAUNCH_STAMP_ROUTER.address) ||
    !Array.isArray(log.topics) ||
    log.topics.length !== 4 ||
    log.topics[0]?.toLowerCase() !== LAUNCH_STAMP_TOPICS.launchStamped ||
    typeof log.data !== "string" ||
    !/^0x[0-9a-fA-F]{192}$/.test(log.data)
  )
    throw new Error("Launch-Stamp-Event ist nicht kanonisch");

  const launchId = decodeBytes32(log.topics[1]);
  const token = topicAddress(log.topics[2]);
  const hook = topicAddress(log.topics[3]);
  requireAbiWords(log.data, 3, "Launch-Stamp-Event");
  const poolManager = wordAddress(abiWord(log.data, 0));
  const poolId = decodeBytes32(abiWord(log.data, 1));
  const stampHash = decodeBytes32(abiWord(log.data, 2));
  if (
    normalizeAddress(token) === normalizeAddress("0x0000000000000000000000000000000000000000") ||
    normalizeAddress(poolManager) !== normalizeAddress(LAUNCH_STAMP_ROUTER.poolManager.address) ||
    /^0x0{64}$/i.test(launchId) ||
    /^0x0{64}$/i.test(poolId) ||
    /^0x0{64}$/i.test(stampHash) ||
    !/^0x[0-9a-fA-F]{64}$/.test(log.blockHash ?? "") ||
    !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash ?? "")
  )
    throw new Error("Launch-Stamp-Identität ist unvollständig");

  return Object.freeze({
    launchId,
    token,
    hook,
    poolManager,
    poolId,
    stampHash,
    blockHash: log.blockHash.toLowerCase(),
    blockNumber: BigInt(log.blockNumber),
    transactionIndex: BigInt(log.transactionIndex),
    logIndex: BigInt(log.logIndex),
    transactionHash: log.transactionHash.toLowerCase(),
  });
}

export function reduceLaunchStampLogs(logs) {
  if (!Array.isArray(logs)) throw new Error("Launch-Stamp-Events fehlen");
  const launches = new Map();
  for (const log of logs) {
    const launch = decodeLaunchStampLog(log);
    if (launches.has(launch.launchId))
      throw new Error("Doppelter Launch-Stamp");
    launches.set(launch.launchId, launch);
  }
  return [...launches.values()].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber)
      return left.blockNumber > right.blockNumber ? -1 : 1;
    if (left.logIndex !== right.logIndex)
      return left.logIndex > right.logIndex ? -1 : 1;
    return left.launchId.localeCompare(right.launchId);
  });
}

export function launchStampLogSetFingerprint(logs) {
  if (!Array.isArray(logs)) throw new Error("Launch-Stamp-Events fehlen");
  const tuples = logs.map((log) => {
    const decoded = decodeLaunchStampLog(log);
    return {
      address: log.address.toLowerCase(),
      blockHash: decoded.blockHash,
      blockNumber: decoded.blockNumber.toString(),
      transactionHash: decoded.transactionHash,
      transactionIndex: decoded.transactionIndex.toString(),
      logIndex: decoded.logIndex.toString(),
      topics: log.topics.map((topic) => topic.toLowerCase()),
      data: log.data.toLowerCase(),
    };
  });
  tuples.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
  return JSON.stringify(tuples);
}

function parseRouterCheckpoints(blocks) {
  if (!Array.isArray(blocks) || blocks.length !== 3)
    throw new Error("Finalisierter Router-Block fehlt im RPC-Quorum");
  return blocks.map((block) => {
    if (
      !block ||
      typeof block.number !== "string" ||
      !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(block.number) ||
      typeof block.hash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(block.hash)
    )
      throw new Error("Finalisierter Router-Block fehlt im RPC-Quorum");
    return Object.freeze({
      number: BigInt(block.number),
      hash: block.hash.toLowerCase(),
    });
  });
}

export function routerFinalizedBoundary(
  blocks,
  minimumBlock = 0n,
  maximumSpread = 32n,
) {
  const checkpoints = parseRouterCheckpoints(blocks);
  const numbers = checkpoints.map(({ number }) => number);
  const first = numbers.reduce((minimum, number) =>
    number < minimum ? number : minimum,
  );
  const last = numbers.reduce((maximum, number) =>
    number > maximum ? number : maximum,
  );
  if (maximumSpread < 0n || last - first > maximumSpread)
    throw new Error(
      "Finalisierte Router-Stände liegen im RPC-Quorum zu weit auseinander",
    );
  if (first < BigInt(minimumBlock))
    throw new Error("Launch-Stamp-Router hat noch keinen finalisierten Bereich");
  return first;
}

export function exactRouterFinalizedCheckpoint(blocks, minimumBlock = 0n) {
  const checkpoints = parseRouterCheckpoints(blocks);
  if (
    new Set(
      checkpoints.map(({ number, hash }) => `${number.toString()}:${hash}`),
    ).size !== 1
  )
    throw new Error(
      "Finalisierter Router-Block stimmt im RPC-Quorum nicht überein",
    );
  if (checkpoints[0].number < BigInt(minimumBlock))
    throw new Error("Launch-Stamp-Router hat noch keinen finalisierten Bereich");
  return checkpoints[0];
}

export function decodeLaunchStampRecord(value) {
  requireAbiWords(value, 14, "Launch-Stamp-Record");
  const kind = Number(decodeUint256(abiWord(value, 0)));
  if (kind !== 1 && kind !== 2)
    throw new Error("Launch-Stamp-Art wird nicht unterstützt");
  const record = {
    kind,
    launchWallet: wordAddress(abiWord(value, 1)),
    token: wordAddress(abiWord(value, 2)),
    hook: wordAddress(abiWord(value, 3)),
    poolManager: wordAddress(abiWord(value, 4)),
    poolId: decodeBytes32(abiWord(value, 5)),
    poolKeyHash: decodeBytes32(abiWord(value, 6)),
    componentSetHash: decodeBytes32(abiWord(value, 7)),
    routePayloadHash: decodeBytes32(abiWord(value, 8)),
    routeLauncher: wordAddress(abiWord(value, 9)),
    routeLauncherRuntimeCodeHash: decodeBytes32(abiWord(value, 10)),
    expectedResultHash: decodeBytes32(abiWord(value, 11)),
    permitDigest: decodeBytes32(abiWord(value, 12)),
    stampHash: decodeBytes32(abiWord(value, 13)),
  };
  for (const key of [
    "poolId",
    "poolKeyHash",
    "componentSetHash",
    "routePayloadHash",
    "routeLauncherRuntimeCodeHash",
    "expectedResultHash",
    "permitDigest",
    "stampHash",
  ]) {
    if (/^0x0{64}$/i.test(record[key]))
      throw new Error(`Launch-Stamp ${key} ist null`);
  }
  return Object.freeze(record);
}

export function decodeLaunchStampProof(value) {
  requireAbiWords(value, 2, "Launch-Stamp-Proof");
  return Object.freeze({
    launchId: decodeBytes32(abiWord(value, 0)),
    stampHash: decodeBytes32(abiWord(value, 1)),
  });
}

function topicAddress(topic) {
  if (
    typeof topic !== "string" ||
    !/^0x0{24}[0-9a-fA-F]{40}$/.test(topic)
  )
    throw new Error("Ungültige Custom-Eventadresse");
  return `0x${topic.slice(-40)}`;
}

function wordAddress(word) {
  return topicAddress(word);
}

function customLogPosition(log) {
  return [BigInt(log.blockNumber ?? 0), BigInt(log.logIndex ?? 0)];
}

function compareCustomLogs(left, right) {
  const [leftBlock, leftIndex] = customLogPosition(left);
  const [rightBlock, rightIndex] = customLogPosition(right);
  if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1;
  return leftIndex === rightIndex ? 0 : leftIndex < rightIndex ? -1 : 1;
}

export function decodeCustomRegistryLog(log) {
  if (!log || !Array.isArray(log.topics) || typeof log.topics[0] !== "string")
    throw new Error("Ungültiges Custom-Registry-Event");
  if (
    log.removed === true ||
    normalizeAddress(log.address) !== normalizeAddress(CUSTOM_REGISTRY.address)
  )
    throw new Error("Custom-Registry-Event ist nicht kanonisch");

  const topic = log.topics[0].toLowerCase();
  const launchId = log.topics[1]?.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(launchId ?? ""))
    throw new Error("Custom-Launch-ID fehlt");

  if (topic === CUSTOM_EVENT_TOPICS.registered) {
    if (log.topics.length !== 4)
      throw new Error("Custom-Registrierung hat falsche Topics");
    return {
      type: "registered",
      launchId,
      projectId: log.topics[2].toLowerCase(),
      primaryContract: topicAddress(log.topics[3]),
      registrationSequence: decodeUint256(abiWord(log.data, 0)),
      chainId: decodeUint256(abiWord(log.data, 1)),
      registryGeneration: decodeUint256(abiWord(log.data, 2)),
      transactionHash: log.transactionHash,
    };
  }

  if (topic === CUSTOM_EVENT_TOPICS.provenance) {
    return {
      type: "provenance",
      launchId,
      primaryRuntimeCodeHash: abiWord(log.data, 6).toLowerCase(),
    };
  }

  if (topic === CUSTOM_EVENT_TOPICS.feePolicy) {
    return {
      type: "feePolicy",
      launchId,
      feePolicyHash: log.topics[2].toLowerCase(),
      kind: Number(decodeUint256(abiWord(log.data, 0))),
      totalFeeBps: Number(decodeUint256(abiWord(log.data, 1))),
      nativeCustomFeeBps: Number(decodeUint256(abiWord(log.data, 2))),
      partnerShareBps: Number(decodeUint256(abiWord(log.data, 3))),
      programmableShareBps: Number(decodeUint256(abiWord(log.data, 4))),
      partnerRecipient: wordAddress(abiWord(log.data, 5)),
      programmableRecipient: wordAddress(abiWord(log.data, 6)),
    };
  }

  if (topic === CUSTOM_EVENT_TOPICS.finalized)
    return { type: "finalized", launchId };
  if (topic === CUSTOM_EVENT_TOPICS.revoked)
    return { type: "revoked", launchId };
  throw new Error("Unbekanntes Custom-Registry-Event");
}

export function reduceCustomRegistryLogs(logs) {
  if (!Array.isArray(logs)) throw new Error("Custom-Events fehlen");
  const launches = new Map();
  const getLaunch = (launchId) => {
    const existing = launches.get(launchId) ?? {
      launchId,
      finalized: false,
      revoked: false,
    };
    launches.set(launchId, existing);
    return existing;
  };

  for (const log of [...logs].sort(compareCustomLogs)) {
    const event = decodeCustomRegistryLog(log);
    const launch = getLaunch(event.launchId);
    if (event.type === "registered") {
      if (launch.primaryContract)
        throw new Error("Doppelte Custom-Registrierung");
      Object.assign(launch, event);
    } else if (event.type === "provenance") {
      if (launch.primaryRuntimeCodeHash)
        throw new Error("Doppelte Custom-Provenance");
      launch.primaryRuntimeCodeHash = event.primaryRuntimeCodeHash;
    } else if (event.type === "feePolicy") {
      if (launch.feePolicy) throw new Error("Doppelte Custom-Fee-Policy");
      launch.feePolicy = event;
    } else if (event.type === "finalized") {
      if (launch.finalized) throw new Error("Doppelte Custom-Finalisierung");
      launch.finalized = true;
    } else if (event.type === "revoked") {
      if (launch.revoked) throw new Error("Doppelter Custom-Widerruf");
      launch.revoked = true;
    }
  }

  return [...launches.values()]
    .filter(({ primaryContract }) => Boolean(primaryContract))
    .sort((left, right) =>
      left.registrationSequence < right.registrationSequence ? -1 : 1,
    );
}

export function customLaunchStateData(launchId) {
  if (typeof launchId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(launchId))
    throw new Error("Ungültige Custom-Launch-ID");
  return `${SELECTORS.customLaunchState}${launchId.slice(2).toLowerCase()}`;
}

export function decodeCustomLaunchState(value) {
  return {
    status: Number(decodeUint256(abiWord(value, 0))),
    feePolicyHash: abiWord(value, 6).toLowerCase(),
  };
}

export function customLaunchClassification(launch) {
  const policy = launch?.feePolicy;
  if (
    !policy ||
    launch?.stateVerified !== true ||
    launch?.runtimeVerified !== true
  )
    return "blocked";
  if (launch.revoked || launch.currentStatus === 3) return "revoked";
  if (!launch.finalized || launch.currentStatus !== 2) return "pending";
  if (policy.kind === CUSTOM_FEE_POLICY_KIND.noQualifyingMarket)
    return "no-market";
  if (
    policy.programmableShareBps === 0 ||
    !isTreasury(policy.programmableRecipient)
  )
    return "blocked";
  if (launch.standardClaimBindingVerified === true)
    return launch.amount === 0n ? "empty" : "ready";
  return "adapter-required";
}

function exactAddress(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error(`${label} fehlt oder ist keine Ethereum-Adresse`);
  if (/^0x0{40}$/i.test(value)) throw new Error(`${label} ist die Nulladresse`);
  return value;
}

function exactHash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${label} fehlt oder ist kein bytes32-Wert`);
  if (/^0x0{64}$/i.test(value)) throw new Error(`${label} ist null`);
  return value.toLowerCase();
}

function exactGitObject(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value))
    throw new Error(`${label} ist kein exaktes Git-Objekt`);
  return value;
}

export function parseCustomV2Release(value) {
  if (!value || value.schemaVersion !== CUSTOM_V2_POLICY.schemaVersion)
    throw new Error("Custom-V2-Release-Schema stimmt nicht");
  if (value.activationAllowed !== true) {
    if (value.status !== "HOLD")
      throw new Error("Inaktives Custom-V2-Release muss HOLD sein");
    return Object.freeze({ active: false, status: "HOLD" });
  }
  if (value.status !== "READY_FOR_MANUAL_CLAIM")
    throw new Error("Custom-V2-Release ist nicht für manuelle Claims freigegeben");
  if (
    value.deployment?.chainId !== CUSTOM_V2_POLICY.chainId.toString() ||
    !/^[1-9][0-9]*$/.test(value.deployment?.startBlock ?? "")
  )
    throw new Error("Custom-V2-Deployment-Scope stimmt nicht");

  const policy = value.policy;
  if (
    normalizeAddress(policy?.asset) !==
      normalizeAddress(CUSTOM_V2_POLICY.nativeAsset) ||
    !isTreasury(policy?.recipient) ||
    policy?.programmableFeeBps !==
      CUSTOM_V2_POLICY.programmableFeeBps.toString() ||
    policy?.claimSelector?.toLowerCase() !== CUSTOM_V2_POLICY.claimSelector ||
    policy?.sourceInterfaceId?.toLowerCase() !==
      CUSTOM_V2_POLICY.sourceInterfaceId ||
    policy?.minimumActivationDelayBlocks !==
      CUSTOM_V2_POLICY.minimumFinalityBlocks.toString() ||
    policy?.minimumLaunchFinalityBlocks !==
      CUSTOM_V2_POLICY.minimumFinalityBlocks.toString()
  )
    throw new Error("Custom-V2-Fee-Policy stimmt nicht");

  const contracts = {};
  for (const key of [
    "sourceRegistry",
    "customRegistryV2",
    "customRegistrar",
    "launchStampRouter",
  ]) {
    contracts[key] = Object.freeze({
      address: exactAddress(value.contracts?.[key]?.address, `${key} Adresse`),
      runtimeCodeHash: exactHash(
        value.contracts?.[key]?.runtimeCodeHash,
        `${key} Runtime`,
      ),
    });
  }
  const contractAddresses = Object.values(contracts).map(({ address }) =>
    normalizeAddress(address),
  );
  if (new Set(contractAddresses).size !== contractAddresses.length)
    throw new Error("Custom-V2-Contract-Adressen müssen eindeutig sein");
  if (
    value.sourceRevision?.repository !==
    "https://github.com/0xprogrammable/programmable"
  )
    throw new Error("Custom-V2-Source-Repository stimmt nicht");

  return Object.freeze({
    active: true,
    status: value.status,
    startBlock: BigInt(value.deployment.startBlock),
    sourceRevision: Object.freeze({
      repository: value.sourceRevision.repository,
      commit: exactGitObject(value.sourceRevision?.commit, "Source Commit"),
      tree: exactGitObject(value.sourceRevision?.tree, "Source Tree"),
    }),
    contracts: Object.freeze(contracts),
  });
}

export function decodeCustomV2SourceState(value) {
  requireAbiWords(value, 9, "Custom-V2-Source-State");
  return Object.freeze({
    sourceId: decodeBytes32(abiWord(value, 0)),
    source: wordAddress(abiWord(value, 1)),
    runtimeCodeHash: decodeBytes32(abiWord(value, 2)),
    asset: wordAddress(abiWord(value, 3)),
    claimSelector: decodeBytes4(abiWord(value, 4)),
    recipient: wordAddress(abiWord(value, 5)),
    activationBlock: decodeUint256(abiWord(value, 6)),
    registered: decodeBool(abiWord(value, 7)),
    quarantined: decodeBool(abiWord(value, 8)),
  });
}

export function customV2SourceClassification(source) {
  if (!source || source.bindingVerified !== true) return "blocked";
  if (!source.registered || source.quarantined || !source.executable)
    return "quarantined";
  if (typeof source.amount !== "bigint" || source.amount < 0n) return "blocked";
  if (source.amount === 0n) return "empty";
  return "ready";
}

export function routerCustomClaimClassification(source) {
  if (
    !source ||
    source.origin !== "launch-stamp-router" ||
    source.provenanceVerified !== true ||
    source.runtimeVerified !== true
  )
    return "blocked";
  if (source.claimMode === "no-manual-claim") return "no-manual-claim";
  if (
    source.claimMode !== "manual" ||
    source.claimBindingVerified !== true ||
    typeof source.amount !== "bigint" ||
    source.amount < 0n ||
    (source.secondaryAmount !== undefined &&
      (typeof source.secondaryAmount !== "bigint" ||
        source.secondaryAmount < 0n))
  )
    return "blocked";
  return source.amount === 0n && (source.secondaryAmount ?? 0n) === 0n
    ? "empty"
    : "ready";
}

// Unknown adapters are outside a verified-source claim. A broken provenance or
// a failed binding for an otherwise supported adapter still blocks submission.
export function routerClaimCoverage(launches) {
  const unsupported = [], blocked = [];
  for (const launch of launches) {
    const unresolved = launch.launchKind === 1
      ? routerCustomClaimClassification(launch) === "blocked"
      : launch.launchKind === 2 && launch.claimMode === "unsupported";
    if (!unresolved) continue;
    if (launch.claimMode === "unsupported" && launch.provenanceVerified === true &&
        launch.runtimeVerified === true) unsupported.push(launch);
    else blocked.push(launch);
  }
  return { unsupported, blocked };
}

export function customClaimDefinitionClassification(claim, current = {}) {
  const source = { ...claim, ...current };
  if (claim?.origin === "launch-stamp-router")
    return routerCustomClaimClassification(source);
  return claim?.standardClaimBindingVerified === true
    ? customLaunchClassification(source)
    : customV2SourceClassification(source);
}

export function createRefreshQueue(run) {
  if (typeof run !== "function")
    throw new Error("Refresh-Runner fehlt");
  let requested = false;
  let active = null;

  return async function requestRefresh() {
    requested = true;
    while (true) {
      if (!active) {
        active = (async () => {
          try {
            while (requested) {
              requested = false;
              try {
                await run();
              } catch (error) {
                if (!requested) throw error;
              }
            }
          } finally {
            active = null;
          }
        })();
      }
      await active;
      if (!requested && active === null) return;
    }
  };
}

export function createLatestOperationGuard() {
  let generation = 0;
  return Object.freeze({
    begin() {
      const operationGeneration = ++generation;
      return Object.freeze({
        isCurrent() {
          return operationGeneration === generation;
        },
      });
    },
    invalidate() {
      generation += 1;
    },
  });
}

export function formatEth(value, maximumFractionDigits = 6) {
  return formatUnits(value, 18, maximumFractionDigits);
}

export function formatUnits(value, decimals, maximumFractionDigits = 6) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const precision = Math.max(0, Math.min(decimals, maximumFractionDigits));
  if (precision === 0 || fraction === 0n) return whole.toString();
  const padded = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, precision);
  const trimmed = padded.replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString();
}

export function encodeAddressArgument(address) {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address))
    throw new Error("Ethereum-Adresse erwartet");
  return address.slice(2).toLowerCase().padStart(64, "0");
}

export function encodeUint256Argument(value) {
  if (typeof value !== "bigint" || value < 0n || value >= 1n << 256n)
    throw new Error("uint256 erwartet");
  return value.toString(16).padStart(64, "0");
}

export function encodeBytes32Argument(value) {
  return decodeBytes32(value).slice(2);
}

export function customV2IndexedReadData(selector, index) {
  return `${selector}${encodeUint256Argument(index)}`;
}

export function customV2Bytes32ReadData(selector, value) {
  return `${selector}${encodeBytes32Argument(value)}`;
}

export function launchStampBytes32ReadData(selector, value) {
  if (typeof selector !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(selector))
    throw new Error("Launch-Stamp-Selector ist ungültig");
  return `${selector.toLowerCase()}${encodeBytes32Argument(value)}`;
}

export function launchStampAddressReadData(selector, value) {
  if (typeof selector !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(selector))
    throw new Error("Launch-Stamp-Selector ist ungültig");
  return `${selector.toLowerCase()}${encodeAddressArgument(value)}`;
}

export function launchStampPoolReadData(selector, poolManager, poolId) {
  if (typeof selector !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(selector))
    throw new Error("Launch-Stamp-Selector ist ungültig");
  return `${selector.toLowerCase()}${encodeAddressArgument(poolManager)}${encodeBytes32Argument(poolId)}`;
}

export function poolManagerBalanceOfData(selector, owner, currency) {
  if (typeof selector !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(selector))
    throw new Error("PoolManager-Selector ist ungültig");
  return `${selector.toLowerCase()}${encodeAddressArgument(owner)}${encodeAddressArgument(currency)}`;
}

function exactCallData(value, label) {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{64})*$/.test(value)
  )
    throw new Error(`${label} ist ungültig`);
  return value.toLowerCase();
}

export function readAccruedData(claim) {
  if (claim?.readData !== undefined)
    return exactCallData(claim.readData, "Claim-Lesedaten");
  if (claim.kind === "custom")
    return `${CUSTOM_V2_SELECTORS.accruedProgrammableFees}${encodeAddressArgument(CUSTOM_V2_POLICY.nativeAsset)}`;
  return claim.kind === "asset"
    ? `${SELECTORS.launcherAssetFeesAccrued}${encodeAddressArgument(claim.asset)}`
    : SELECTORS.launcherFeesAccrued;
}

export function claimData(claim) {
  if (claim?.claimData !== undefined)
    return exactCallData(claim.claimData, "Claim-Calldata");
  if (claim.kind === "custom")
    return `${CUSTOM_V2_SELECTORS.claimProgrammableFees}${encodeAddressArgument(CUSTOM_V2_POLICY.nativeAsset)}`;
  return claim.kind === "asset"
    ? `${SELECTORS.claimLauncherAssetFees}${encodeAddressArgument(claim.asset)}`
    : SELECTORS.claimLauncherFees;
}

export function toQuantityHex(value) {
  if (typeof value !== "bigint" || value < 0n)
    throw new Error("Nichtnegative Ganzzahl erwartet");
  return `0x${value.toString(16)}`;
}

export function shortAddress(value) {
  if (typeof value !== "string" || value.length < 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function usableWalletProvider(provider) {
  return provider !== null && typeof provider?.request === "function";
}

export function metaMaskProviderFrom(
  announcedProviderDetails = [],
  legacyProvider = null,
) {
  const announced = Array.isArray(announcedProviderDetails)
    ? announcedProviderDetails.filter(({ provider }) =>
        usableWalletProvider(provider),
      )
    : [];
  const exact = announced.find(
    ({ info }) =>
      typeof info?.rdns === "string" &&
      info.rdns.toLowerCase() === "io.metamask",
  );
  if (exact) return exact.provider;

  const legacyCandidates = Array.isArray(legacyProvider?.providers)
    ? legacyProvider.providers
    : [legacyProvider];
  return (
    legacyCandidates.find(
      (provider) =>
        usableWalletProvider(provider) &&
        provider.isMetaMask === true &&
        provider.isBraveWallet !== true,
    ) ?? null
  );
}

export function atomicCapabilityStatus(
  capabilities,
  chainId = MAINNET_CHAIN_ID,
) {
  const status = capabilities?.[chainId]?.atomic?.status;
  return status === "supported" || status === "ready" ? status : null;
}

export function requireAtomicClaimCapability(capability) {
  if (capability !== "supported" && capability !== "ready") {
    throw new Error(
      "Eine gemeinsame Wallet-Bestätigung ist mit diesem MetaMask-Konto nicht verfügbar. Es wurde nichts gesendet.",
    );
  }
  return capability;
}

// MetaMask currently accepts at most ten calls in wallet_sendCalls.
export const WALLET_CLAIM_BATCH_LIMIT = 10;

export function nextWalletClaimBatch(claims) {
  return claims.slice(0, WALLET_CLAIM_BATCH_LIMIT);
}

export function buildWalletSendCalls(account, claims) {
  if (!isTreasury(account))
    throw new Error("Die Treasury-Wallet muss verbunden sein");
  if (!Array.isArray(claims) || claims.length === 0)
    throw new Error("Keine Claims verfügbar");
  const calls = claims.map((claim) => ({
    to: claim.address,
    data: claimData(claim),
    value: "0x0",
  }));
  const callKeys = calls.map(
    ({ to, data }) => `${normalizeAddress(to)}:${data.toLowerCase()}`,
  );
  if (new Set(callKeys).size !== callKeys.length)
    throw new Error("Doppelter Claim im atomaren Batch");
  return {
    version: "2.0.0",
    from: account,
    chainId: MAINNET_CHAIN_ID,
    atomicRequired: true,
    calls,
  };
}

export function normalizeBatchId(result) {
  const id = typeof result === "string" ? result : result?.id;
  if (typeof id !== "string" || !/^0x[0-9a-fA-F]+$/.test(id))
    throw new Error("MetaMask hat keine gültige Batch-ID geliefert");
  return id;
}

export function walletSendDefinitelyNotSubmitted(error) {
  return [-32602, 4001, 4100, 5700, 5710, 5740, 5750, 5760].includes(
    error?.code,
  );
}

export function walletSendDuplicateBatchId(error) {
  return error?.code === 5720;
}

export function validatedAtomicBatchStatus(
  result,
  expectedId,
  expectedChainId = MAINNET_CHAIN_ID,
) {
  const resultId = normalizeBatchId(result?.id);
  const normalizedExpectedId = normalizeBatchId(expectedId);
  if (
    result?.version !== "2.0.0" ||
    resultId.toLowerCase() !== normalizedExpectedId.toLowerCase() ||
    typeof result?.chainId !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(result.chainId) ||
    BigInt(result.chainId) !== BigInt(expectedChainId) ||
    !Number.isInteger(result?.status) ||
    result?.atomic !== true
  ) {
    throw new Error("Der Wallet-Batchstatus stimmt nicht mit dem Claim überein");
  }
  return result.status;
}

export function confirmedBatchReceiptProof(
  result,
  expectedId,
  expectedChainId = MAINNET_CHAIN_ID,
) {
  if (
    validatedAtomicBatchStatus(result, expectedId, expectedChainId) !== 200 ||
    !Array.isArray(result.receipts) ||
    result.receipts.length === 0
  )
    throw new Error("Der atomare Claim-Batch ist nicht vollständig bestätigt");

  let highestBlock = 0n;
  const transactionHashes = new Set();
  const receipts = [];
  for (const receipt of result.receipts) {
    if (receipt?.status !== "0x1")
      throw new Error("Der atomare Claim-Batch ist fehlgeschlagen");
    if (
      typeof receipt.blockNumber !== "string" ||
      !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber)
    ) {
      throw new Error("Dem bestätigten Claim-Batch fehlt der Receipt-Block");
    }
    const blockNumber = BigInt(receipt.blockNumber);
    if (blockNumber <= 0n)
      throw new Error("Der Receipt-Block des Claim-Batches ist ungültig");
    if (
      typeof receipt.blockHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash) ||
      typeof receipt.transactionHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(receipt.transactionHash)
    ) {
      throw new Error("Dem bestätigten Claim-Batch fehlt die Receipt-Identität");
    }
    const transactionHash = receipt.transactionHash.toLowerCase();
    if (transactionHashes.has(transactionHash))
      throw new Error("Der Claim-Batch enthält einen doppelten Receipt");
    transactionHashes.add(transactionHash);
    receipts.push({
      blockNumber,
      blockHash: receipt.blockHash.toLowerCase(),
      transactionHash,
    });
    if (blockNumber > highestBlock) highestBlock = blockNumber;
  }
  return { highestBlock, receipts };
}

export function confirmedTransactionReceiptMatches(proof, receipt) {
  if (
    typeof proof?.blockNumber !== "bigint" ||
    proof.blockNumber <= 0n ||
    typeof proof?.blockHash !== "string" ||
    typeof proof?.transactionHash !== "string" ||
    receipt?.status !== "0x1" ||
    typeof receipt?.blockNumber !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber)
  ) {
    return false;
  }
  return (
    BigInt(receipt.blockNumber) === proof.blockNumber &&
    receipt.blockHash?.toLowerCase() === proof.blockHash.toLowerCase() &&
    receipt.transactionHash?.toLowerCase() ===
      proof.transactionHash.toLowerCase()
  );
}
