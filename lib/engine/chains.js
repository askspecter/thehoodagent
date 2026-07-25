"use strict";

/**
 * Network + pons contract configuration.
 *
 * Values here come from the official pons documentation (Integration → Network /
 * Contracts / Onchain events). Two earlier guesses are corrected: the public RPC
 * lives on the `rpc.mainnet.` host, and the explorer is Blockscout.
 *
 * pons runs on Robinhood Chain: an Arbitrum Orbit L2, ETH for gas, fully
 * EVM-compatible, permissionless deployment.
 */

const PONS = {
  /** Serves current launches. 70/30 creator/protocol fee split. */
  factory: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
  factoryStartBlock: 8_991_118,
  locker: "0x736D76699C26D0d966744cAe304C000d471f7F35",

  /** Tokens deployed before the current version. 90/10 split, snapshotted. */
  legacyFactory: "0x0c37a24F5D23A486FA692d1500881d698B1F77a4",
  legacyFactoryStartBlock: 8_600_612,
  legacyLocker: "0x31ca5E101941A93A7DD6d0497928700625CF54B5",

  /** The Uniswap V3 stack every launch trades in. */
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  swapRouter: "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoter: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",

  /** Every pons pool uses the 1% tier, so there is no need to probe tiers. */
  poolFee: 10_000,
  /** Fixed for every launch: 1,000,000,000 * 1e18. */
  launchSupply: 1_000_000_000n * 10n ** 18n,
  launchFeeEth: "0.0005",
  /** Default graduation threshold in paired WETH; read on-chain to be exact. */
  graduationThresholdEth: "4.2",
};

/** Event topic0 values, for indexing launches and trades. */
const TOPICS = {
  tokenLaunched: "0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a",
  swap: "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
};

/**
 * A graduated token with known on-chain state, published by pons specifically so
 * an integration can be validated against it. Handy as a smoke test.
 */
const REFERENCE = {
  token: "0x39dBED3a2bd333467115dE45665cC57F813C4571",
  pool: "0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA",
  note: "PONS — graduated, launched via the legacy factory (90/10 split).",
};

const CHAINS = {
  robinhood: {
    key: "robinhood",
    name: "Robinhood Chain",
    chainId: 4663,
    // Documented public endpoint. Note the `mainnet` label in the host — an
    // earlier version of this file omitted it and could not connect at all.
    rpc: process.env.ROBINHOOD_RPC || "https://rpc.mainnet.chain.robinhood.com",
    explorer: process.env.ROBINHOOD_EXPLORER || "https://robinhoodchain.blockscout.com",
    gasSymbol: "ETH",
    wrappedNative: process.env.ROBINHOOD_WETH || PONS.weth,
    feeTiers: [PONS.poolFee],
    pons: {
      ...PONS,
      factory: process.env.PONS_FACTORY || PONS.factory,
      swapRouter: process.env.PONS_ROUTER || PONS.swapRouter,
      quoter: process.env.PONS_QUOTER || PONS.quoter,
    },
    topics: TOPICS,
    reference: REFERENCE,
  },

  /**
   * Testnet details are NOT in the pons docs — pons is mainnet-only. Kept for
   * contract work on Robinhood Chain testnet; there is no pons deployment here,
   * so launchpad reads and the honeypot simulation will report themselves as
   * skipped rather than silently passing.
   */
  robinhoodTestnet: {
    key: "robinhoodTestnet",
    name: "Robinhood Chain Testnet",
    chainId: 46630,
    rpc: process.env.ROBINHOOD_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com",
    explorer: process.env.ROBINHOOD_TESTNET_EXPLORER || null,
    gasSymbol: "ETH",
    wrappedNative: null,
    feeTiers: [10_000, 3_000, 500],
    pons: {},
    topics: TOPICS,
  },

  /** `npx hardhat node` on your own machine. Used by the test suite. */
  local: {
    key: "local",
    name: "Local EVM",
    chainId: 31337,
    rpc: process.env.LOCAL_RPC || "http://127.0.0.1:8545",
    explorer: null,
    gasSymbol: "ETH",
    wrappedNative: null,
    feeTiers: [10_000, 3_000, 500],
    pons: {},
    topics: TOPICS,
  },
};

function getChain(key) {
  const chain = CHAINS[key];
  if (!chain) {
    throw new Error(
      `Unknown network "${key}". Available: ${Object.keys(CHAINS).join(", ")}`
    );
  }
  return chain;
}

module.exports = { CHAINS, getChain, PONS, TOPICS, REFERENCE };
