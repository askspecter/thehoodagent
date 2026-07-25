"use strict";

/**
 * Network definitions for the agent.
 *
 * Robinhood Chain is an Arbitrum Orbit L2 that uses ETH for gas, is fully
 * EVM-compatible, and allows permissionless contract deployment.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️  VERIFY THESE ADDRESSES YOURSELF BEFORE RISKING REAL MONEY.            │
 * │                                                                           │
 * │ The Pons addresses below were transcribed from third-party reporting of    │
 * │ the Pons documentation, NOT read from the official docs directly. A wrong  │
 * │ or lookalike router address is one of the most common ways wallets get     │
 * │ drained: you approve a spend to a contract you did not verify.             │
 * │                                                                           │
 * │ Check each against https://docs.ponsfamily.com/ and the Robinhood Chain    │
 * │ block explorer, then set them in .env to override. Beware typosquat        │
 * │ domains — `ponfamily.com` (no "s") is NOT the real site.                   │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

const PONS_MAINNET = {
  // The $PONS token itself.
  ponsToken: "0x39dBED3a2bd333467115dE45665cC57F813C4571",
  // Pons launchpad
  factory: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
  locker: "0x736D76699C26D0d966744cAe304C000d471f7F35",
  legacyFactory: "0x0c37a24F5D23A486FA692d1500881d698B1F77a4",
  legacyLocker: "0x31ca5E101941A93A7DD6d0497928700625CF54B5",
  // Uniswap V3 stack that Pons launches into
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  positionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  swapRouter: "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoter: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
};

/** Robinhood Chain's WETH — every Pons pool is quoted against it. */
const ROBINHOOD_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

/** Uniswap V3 fee tiers to probe when we do not know a token's pool tier. */
const DEFAULT_FEE_TIERS = [10_000, 3_000, 500, 100];

const CHAINS = {
  robinhood: {
    key: "robinhood",
    name: "Robinhood Chain",
    chainId: 4663,
    rpc: process.env.ROBINHOOD_RPC || "https://rpc.chain.robinhood.com",
    explorer: process.env.ROBINHOOD_EXPLORER || "https://explorer.chain.robinhood.com",
    gasSymbol: "ETH",
    wrappedNative: process.env.ROBINHOOD_WETH || ROBINHOOD_WETH,
    feeTiers: DEFAULT_FEE_TIERS,
    pons: {
      ...PONS_MAINNET,
      // .env overrides win, so you can correct any address without editing code.
      factory: process.env.PONS_FACTORY || PONS_MAINNET.factory,
      swapRouter: process.env.PONS_ROUTER || PONS_MAINNET.swapRouter,
      quoter: process.env.PONS_QUOTER || PONS_MAINNET.quoter,
    },
    verified: false, // flip to true once YOU have checked the addresses
  },

  robinhoodTestnet: {
    key: "robinhoodTestnet",
    name: "Robinhood Chain Testnet",
    chainId: 46630,
    rpc: process.env.ROBINHOOD_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com",
    explorer:
      process.env.ROBINHOOD_TESTNET_EXPLORER ||
      "https://explorer.testnet.chain.robinhood.com",
    gasSymbol: "ETH",
    wrappedNative: null,
    feeTiers: DEFAULT_FEE_TIERS,
    pons: {},
    verified: false,
  },

  // A `npx hardhat node` on your own machine. Used by the test suite.
  local: {
    key: "local",
    name: "Local EVM",
    chainId: 31337,
    rpc: process.env.LOCAL_RPC || "http://127.0.0.1:8545",
    explorer: null,
    gasSymbol: "ETH",
    wrappedNative: null,
    feeTiers: DEFAULT_FEE_TIERS,
    pons: {},
    verified: true,
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

module.exports = { CHAINS, getChain, PONS_MAINNET, ROBINHOOD_WETH, DEFAULT_FEE_TIERS };
