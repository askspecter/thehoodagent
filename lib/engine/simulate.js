"use strict";

const { Contract, parseEther, formatEther } = require("ethers");

/**
 * Honeypot detection by simulation.
 *
 * The idea: before you spend anything, ask the chain "if I bought this token
 * and then immediately sold it, what would happen?" We do that with `eth_call`
 * against Uniswap V3's QuoterV2, which runs the real swap path — including the
 * token's own transfer logic — and then reverts. Nothing is spent, no wallet is
 * needed, and no approval is granted.
 *
 * That last part is what makes it powerful: a honeypot's sell block lives in the
 * token's `_transfer`/`_update` hook, and the quote executes that hook. So if
 * selling is blocked, the sell quote reverts while the buy quote succeeds.
 *
 * ── Honest limits ────────────────────────────────────────────────────────────
 * A quote cannot catch every trap:
 *   • Traps keyed on `tx.origin`, block number, or a per-wallet allowlist may
 *     quote fine and still fail for you in a real transaction.
 *   • A blacklist can be applied AFTER you buy — a clean result now says
 *     nothing about tomorrow.
 *   • An owner who can call `setFee` can raise the tax after your check.
 * Treat a pass as "no trap visible right now", never as "safe".
 */

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

const V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
];

const ZERO = "0x0000000000000000000000000000000000000000";

/** Ask the V3 factory which fee tiers actually have a pool for token/WETH. */
async function findPools(provider, factoryAddress, token, weth, feeTiers) {
  const factory = new Contract(factoryAddress, V3_FACTORY_ABI, provider);
  const pools = [];
  for (const fee of feeTiers) {
    try {
      const pool = await factory.getPool(token, weth, fee);
      if (pool && pool !== ZERO) pools.push({ fee, pool });
    } catch {
      /* tier not supported by this factory — keep probing the others */
    }
  }
  return pools;
}

/**
 * Run one direction of a swap through the quoter.
 * @returns {{ok: true, amountOut: bigint, gasEstimate: bigint} | {ok: false, reason: string}}
 */
async function quote(provider, quoterAddress, { tokenIn, tokenOut, amountIn, fee }) {
  const quoter = new Contract(quoterAddress, QUOTER_V2_ABI, provider);
  try {
    // staticCall because QuoterV2's function is non-view by design (it reverts
    // internally to unwind the simulated swap).
    const result = await quoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0n,
    });
    return { ok: true, amountOut: result[0], gasEstimate: result[3] };
  } catch (error) {
    return { ok: false, reason: shortReason(error) };
  }
}

function shortReason(error) {
  const raw = error?.shortMessage || error?.reason || error?.message || "call reverted";
  return String(raw).slice(0, 200);
}

/**
 * Simulate buying `probeEth` worth of the token, then selling all of it back.
 *
 * @returns a structured verdict plus findings ready to merge into an audit report.
 */
async function simulateRoundTrip(provider, chain, token, options = {}) {
  const { probeEth = "0.01" } = options;
  const weth = chain.wrappedNative;
  const quoterAddress = chain.pons?.quoter;
  const factoryAddress = chain.pons?.v3Factory;

  const out = {
    ran: false,
    skipReason: null,
    pools: [],
    buy: null,
    sell: null,
    lossPercent: null,
    findings: [],
  };

  if (!weth || !quoterAddress) {
    out.skipReason =
      "No WETH/quoter address configured for this network, so buy/sell simulation could not run.";
    return out;
  }

  // 1. Which pool would we even trade through?
  //
  // For a pons launch we already know the answer exactly — the token reports its
  // own `liquidityPool()` and the factory reports its `poolFee` — so we skip the
  // guesswork entirely. `options.knownFee` carries that through.
  if (options.knownFee) {
    out.pools = [{ fee: Number(options.knownFee), pool: options.knownPool || null }];
    out.poolSource = "pons launch data";
  } else if (factoryAddress) {
    out.pools = await findPools(provider, factoryAddress, token, weth, chain.feeTiers || [10_000]);
    out.poolSource = "probed V3 factory";
    if (out.pools.length === 0) {
      out.ran = true;
      out.findings.push({
        severity: "critical",
        id: "no-pool",
        title: "No liquidity pool found",
        detail:
          "No Uniswap V3 pool exists for this token against WETH at any standard fee tier. There is nothing to trade — you could buy nothing, or buy into a pool that does not exist yet.",
      });
      return out;
    }
  }

  const fee = out.pools[0]?.fee ?? (chain.feeTiers?.[0] || 10_000);
  const amountIn = parseEther(String(probeEth));

  // 2. Can we buy?
  const buy = await quote(provider, quoterAddress, {
    tokenIn: weth,
    tokenOut: token,
    amountIn,
    fee,
  });
  out.buy = buy;
  out.ran = true;

  if (!buy.ok) {
    out.findings.push({
      severity: "high",
      id: "buy-reverts",
      title: "Buy simulation reverted",
      detail: `Quoting ${probeEth} WETH → token failed (${buy.reason}). The pool may be empty, unopened, or the token blocks incoming transfers.`,
    });
    return out;
  }

  if (buy.amountOut === 0n) {
    out.findings.push({
      severity: "high",
      id: "buy-zero",
      title: "Buy returns zero tokens",
      detail: "The pool quotes 0 tokens out. Liquidity is effectively absent.",
    });
    return out;
  }

  // 3. The important half — can we get back out?
  const sell = await quote(provider, quoterAddress, {
    tokenIn: token,
    tokenOut: weth,
    amountIn: buy.amountOut,
    fee,
  });
  out.sell = sell;

  if (!sell.ok) {
    out.findings.push({
      severity: "critical",
      id: "honeypot",
      title: "HONEYPOT: buying works, selling reverts",
      detail: `Buying ${probeEth} WETH of this token simulates fine, but selling it straight back reverts (${sell.reason}). Money goes in and cannot come out. Do not buy this.`,
    });
    return out;
  }

  // 4. Round-trip loss. Two 1% pool fees plus price impact is normal; a large
  //    gap means a transfer tax is eating the trade.
  const returned = sell.amountOut;
  const lossBps = Number(((amountIn - returned) * 10_000n) / amountIn);
  out.lossPercent = lossBps / 100;
  out.returnedEth = formatEther(returned);

  if (lossBps >= 5_000) {
    out.findings.push({
      severity: "critical",
      id: "extreme-tax",
      title: `Round trip loses ${out.lossPercent.toFixed(1)}% of your money`,
      detail: `Selling straight back returns only ${out.returnedEth} of ${probeEth} WETH. A tax this large is a soft honeypot — technically sellable, practically not.`,
    });
  } else if (lossBps >= 2_000) {
    out.findings.push({
      severity: "high",
      id: "high-tax",
      title: `Round trip loses ${out.lossPercent.toFixed(1)}%`,
      detail: `Expect roughly 2–4% from pool fees and price impact. ${out.lossPercent.toFixed(1)}% suggests a meaningful transfer tax.`,
    });
  } else if (lossBps >= 1_000) {
    out.findings.push({
      severity: "medium",
      id: "moderate-tax",
      title: `Round trip loses ${out.lossPercent.toFixed(1)}%`,
      detail:
        "Higher than pool fees alone would explain. Could be thin liquidity (price impact) or a modest tax.",
    });
  } else {
    out.findings.push({
      severity: "good",
      id: "sellable",
      title: "Sellable in simulation",
      detail: `Bought and sold back with ${out.lossPercent.toFixed(2)}% round-trip loss, consistent with normal fees. Note: this reflects conditions right now only.`,
    });
  }

  return out;
}

module.exports = { simulateRoundTrip, findPools, quote, QUOTER_V2_ABI, V3_FACTORY_ABI };
