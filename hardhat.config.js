require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { subtask } = require("hardhat/config");
const {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
} = require("hardhat/builtin-tasks/task-names");

// Some sandboxed / corporate networks block binaries.soliditylang.org, which is
// where Hardhat normally downloads solc from. If a matching compiler is already
// present in node_modules (`npm install solc@<version>`), use that instead.
// When it is absent we fall through to Hardhat's normal download behaviour, so
// this is a no-op on an unrestricted machine.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, _hre, runSuper) => {
  const localSolc = path.join(__dirname, "node_modules", "solc", "soljson.js");
  if (fs.existsSync(localSolc)) {
    const pkgVersion = require("solc/package.json").version;
    if (pkgVersion.startsWith(args.solcVersion)) {
      return {
        compilerPath: localSolc,
        isSolcJs: true,
        version: args.solcVersion,
        longVersion: pkgVersion,
      };
    }
  }
  return runSuper();
});

// Private key of the wallet that will DEPLOY the contract and pay gas.
// Put it in a .env file (copy .env.example). NEVER commit .env.
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // ---- Testnets (free test coins — practice here first) ----
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      chainId: 84532,
      accounts,
    },
    // ---- Mainnets (REAL money — deploy here for the live launch) ----
    bsc: {
      url: process.env.BSC_RPC || "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts,
    },
    base: {
      url: process.env.BASE_RPC || "https://mainnet.base.org",
      chainId: 8453,
      accounts,
    },
    mainnet: {
      url: process.env.ETH_RPC || "https://eth.llamarpc.com",
      chainId: 1,
      accounts,
    },
  },
  // For contract verification on the block explorer (optional but recommended).
  etherscan: {
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
      baseSepolia: process.env.BASESCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
    },
  },
};
