"use strict";

const { id } = require("ethers");

/**
 * Function signatures that grant a token deployer power over holders.
 *
 * How this works: when Solidity compiles a contract, its function dispatcher
 * embeds each external function's 4-byte selector directly in the bytecode as
 * a PUSH4 constant. So we can detect which dangerous functions a deployed
 * contract exposes by searching its bytecode for these selectors — no source
 * code and no verification required. That is what makes this work on the
 * thousands of unverified tokens a launchpad produces.
 *
 * `severity` is how much this capability should worry a buyer:
 *   critical — holder can be stopped from selling, or supply can be inflated
 *   high     — economics can be changed under the buyer after they buy
 *   medium   — meaningful centralised control
 *   info     — worth knowing, not inherently bad
 */
const DANGEROUS_FUNCTIONS = [
  // ---- Supply inflation: your holdings can be diluted to nothing ----
  { sig: "mint(address,uint256)", label: "Can mint new tokens", severity: "critical" },
  { sig: "mint(uint256)", label: "Can mint new tokens", severity: "critical" },
  { sig: "_mint(address,uint256)", label: "Internal mint exposed", severity: "critical" },

  // ---- Sell blocking: the honeypot family ----
  { sig: "blacklist(address)", label: "Can blacklist a wallet", severity: "critical" },
  { sig: "setBlacklist(address,bool)", label: "Can blacklist a wallet", severity: "critical" },
  { sig: "addBlacklist(address)", label: "Can blacklist a wallet", severity: "critical" },
  { sig: "setBots(address,bool)", label: "Can flag a wallet as a bot and block it", severity: "critical" },
  { sig: "pause()", label: "Can pause all transfers", severity: "critical" },
  { sig: "unpause()", label: "Can unpause transfers", severity: "info" },
  { sig: "setTradingEnabled(bool)", label: "Can switch trading off", severity: "critical" },
  { sig: "enableTrading()", label: "Trading is gated behind a switch", severity: "high" },
  { sig: "setSwapEnabled(bool)", label: "Can switch swapping off", severity: "critical" },

  // ---- Economics changed after you buy ----
  { sig: "setFee(uint256)", label: "Can change the transfer fee", severity: "high" },
  { sig: "setFees(uint256,uint256)", label: "Can change the transfer fees", severity: "high" },
  { sig: "setTaxes(uint256,uint256)", label: "Can change the taxes", severity: "high" },
  { sig: "updateFees(uint256,uint256)", label: "Can change the fees", severity: "high" },
  { sig: "setBuyTax(uint256)", label: "Can change the buy tax", severity: "high" },
  { sig: "setSellTax(uint256)", label: "Can change the sell tax", severity: "high" },
  { sig: "setMaxTxAmount(uint256)", label: "Can cap how much you may sell at once", severity: "high" },
  { sig: "setMaxWallet(uint256)", label: "Can cap how much you may hold", severity: "high" },

  // ---- Balance manipulation ----
  //
  // `burnFrom` is deliberately INFO, not a warning. In the standard
  // OpenZeppelin ERC20Burnable it is allowance-gated — it can only burn tokens
  // the holder already approved — so it appears in a large share of perfectly
  // ordinary tokens. Bytecode alone cannot prove whether a given
  // implementation checks that allowance, so we surface it without crying wolf:
  // scoring it as a risk would flood the report with false positives, and a
  // scanner that alarms on normal tokens is one people stop reading.
  { sig: "burnFrom(address,uint256)", label: "Has burnFrom (standard when allowance-gated)", severity: "info" },
  { sig: "setBalance(address,uint256)", label: "Can rewrite a wallet balance", severity: "critical" },
  { sig: "excludeFromFee(address)", label: "Can exempt addresses from fees", severity: "medium" },

  // ---- Ownership / control surface ----
  { sig: "owner()", label: "Has an owner", severity: "info" },
  { sig: "transferOwnership(address)", label: "Ownership can be transferred", severity: "info" },
  { sig: "renounceOwnership()", label: "Ownership can be renounced", severity: "info" },
  { sig: "setRouter(address)", label: "Can repoint the DEX router", severity: "high" },
];

/** Standard ERC-20 surface — absence of these means it may not be a token at all. */
const ERC20_FUNCTIONS = [
  "totalSupply()",
  "balanceOf(address)",
  "transfer(address,uint256)",
  "approve(address,uint256)",
  "transferFrom(address,address,uint256)",
  "allowance(address,address)",
];

/** keccak256(signature) truncated to a 4-byte selector, e.g. "0xa9059cbb". */
function selectorOf(signature) {
  return id(signature).slice(0, 10);
}

/** Pre-computed table: each dangerous function with its selector attached. */
const DANGEROUS_TABLE = DANGEROUS_FUNCTIONS.map((entry) => ({
  ...entry,
  selector: selectorOf(entry.sig),
}));

module.exports = {
  DANGEROUS_FUNCTIONS,
  DANGEROUS_TABLE,
  ERC20_FUNCTIONS,
  selectorOf,
};
