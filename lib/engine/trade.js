"use strict";

const {
  Contract,
  Interface,
  formatEther,
  formatUnits,
  getAddress,
  parseEther,
  parseUnits,
} = require("ethers");
const { quote: quoteSwap } = require("./simulate");

/**
 * Turning "buy me $5 nvda" into a transaction.
 *
 * Everything here is quoted against the live pool before it is offered, and the
 * calldata handed back is the exact bytes that will be signed — the client does
 * not rebuild it from a description. Building it in one place is what keeps the
 * number shown on screen and the number in the transaction the same number.
 */

const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const routerIface = new Interface(ROUTER_ABI);
const erc20Iface = new Interface(ERC20_ABI);

/** Twenty minutes is long enough for a slow confirm, short enough to expire. */
const DEADLINE_SECONDS = 20 * 60;

/**
 * Which asset a token trades against.
 *
 * A pons launch is a Uniswap V3 WETH pair, so it quotes and settles in WETH
 * (wrapped native ETH). A tokenized stock is almost always paired against USDG —
 * a USD stablecoin — not WETH. A stock quoted against WETH finds no pool and
 * looks like a honeypot when it is simply the wrong pair, which is exactly the
 * bug this fixes. So the pair is chosen by token kind: a stock uses USDG when the
 * chain has one configured, and everything else uses WETH.
 *
 * `isNative` marks the wrapped-native path: a buy can pay ETH and let the router
 * (or the wrap step) turn it into WETH. A stablecoin quote is a plain ERC-20, so
 * a buy must approve and spend the stablecoin, and a dollar amount IS the amount.
 */
function quoteAssetFor(chain, kind) {
  const pons = chain.pons || {};
  if (kind === "stock" && pons.usdg) {
    return {
      id: "usdg",
      address: pons.usdg,
      symbol: "USDG",
      isNative: false,
      isStable: true,
    };
  }
  return {
    id: "weth",
    address: pons.weth,
    symbol: "WETH",
    isNative: true,
    isStable: false,
  };
}

/** Read the metadata a trade needs. Never throws — a quote is still useful. */
async function tokenMeta(provider, token) {
  const erc20 = new Contract(token, ERC20_ABI, provider);
  const [decimals, symbol, name] = await Promise.all([
    erc20.decimals().catch(() => 18),
    erc20.symbol().catch(() => null),
    erc20.name().catch(() => null),
  ]);
  return { decimals: Number(decimals), symbol: symbol || "TOKEN", name };
}

async function tokenBalance(provider, token, owner) {
  const erc20 = new Contract(token, ERC20_ABI, provider);
  return erc20.balanceOf(owner);
}

/**
 * Work out how many raw units go in, from whatever unit the human used.
 *
 * @returns {{ok: true, amountIn: bigint, basis: string}|{ok: false, error: string}}
 */
async function resolveAmountIn(
  provider,
  { side, amount, token, decimals, owner, ethUsd, quote }
) {
  const { unit, value } = amount;
  // Default to the wrapped-native pair so callers that pass no quote asset keep
  // the old WETH behaviour exactly.
  const q = quote || { isStable: false, symbol: "WETH", decimals: 18 };

  if (side === "buy") {
    // A stablecoin pair (a stock against USDG) spends the stablecoin directly, so
    // a dollar amount IS the amount — no ETH rate, no conversion. Naming ETH here
    // is a category error, because this pool holds no ETH.
    if (q.isStable) {
      if (unit === "eth") {
        return {
          ok: false,
          error: `$${q.symbol} pairs trade in dollars, not ETH. Say a dollar amount: \`buy $5 …\`.`,
        };
      }
      return {
        ok: true,
        amountIn: parseUnits(String(value), q.decimals ?? 18),
        basis: `$${value} in ${q.symbol}`,
      };
    }

    if (unit === "usd") {
      if (!ethUsd) {
        return {
          ok: false,
          error:
            "No ETH/USD rate is available right now, so a dollar amount cannot be converted. Say it in ETH instead: `buy 0.01 eth …`.",
        };
      }
      const eth = value / ethUsd;
      return {
        ok: true,
        amountIn: parseEther(eth.toFixed(18)),
        basis: `$${value} at $${Math.round(ethUsd).toLocaleString()}/ETH`,
      };
    }
    return { ok: true, amountIn: parseEther(String(value)), basis: `${value} ETH` };
  }

  // Selling. A percentage needs a balance to be a percentage of.
  if (unit === "percent") {
    if (!owner) {
      return {
        ok: false,
        error: "Connect a wallet or sign in with X first — a percentage needs a balance to read.",
      };
    }
    const balance = await tokenBalance(provider, token, owner);
    if (balance === 0n) {
      return { ok: false, error: "That wallet holds none of this token." };
    }
    const amountIn = (balance * BigInt(Math.round(value * 100))) / 10_000n;
    if (amountIn === 0n) {
      return { ok: false, error: "That percentage of your balance rounds to zero." };
    }
    return {
      ok: true,
      amountIn,
      basis: `${value}% of ${Number(formatUnits(balance, decimals)).toLocaleString()} held`,
    };
  }

  if (unit === "usd") {
    return {
      ok: false,
      error:
        "Selling by dollar value is not supported yet — the size depends on price impact. Use `sell 50% …` or a token amount.",
    };
  }

  return {
    ok: true,
    amountIn: parseUnits(String(value), decimals),
    basis: `${value} tokens`,
  };
}

/**
 * Quote a trade and build the transaction that would execute it.
 *
 * @returns {Promise<{ok: true, plan: object}|{ok: false, error: string, hint?: string}>}
 */
async function buildTradePlan(provider, chain, options) {
  const {
    side,
    token: tokenInput,
    amount,
    owner = null,
    slippagePercent = 5,
    ethUsd = null,
    kind = null,
  } = options;

  const token = getAddress(tokenInput);
  const { quoter, swapRouter, poolFee } = chain.pons || {};
  const quote = quoteAssetFor(chain, kind);
  if (!quote.address || !quoter || !swapRouter) {
    return {
      ok: false,
      error:
        kind === "stock" && !quote.address
          ? "This network has no USDG address configured, so stock tokens cannot be traded here."
          : "This network has no pons router configured, so it cannot trade.",
    };
  }
  // A stablecoin quote settles in whole USDG, so its decimals matter for sizing
  // and labels. Read them once, off-chain math does the rest.
  const quoteDecimals = quote.isNative ? 18 : (await tokenMeta(provider, quote.address)).decimals;
  quote.decimals = quoteDecimals;

  const meta = await tokenMeta(provider, token);

  const resolved = await resolveAmountIn(provider, {
    side,
    amount,
    token,
    decimals: meta.decimals,
    owner,
    ethUsd,
    quote,
  });
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const amountIn = resolved.amountIn;
  if (amountIn <= 0n) return { ok: false, error: "That amount comes out as zero." };

  const isBuy = side === "buy";

  // Selling more than you hold is caught here rather than by a revert, because a
  // revert costs gas and explains nothing.
  if (!isBuy && owner) {
    const balance = await tokenBalance(provider, token, owner);
    if (balance < amountIn) {
      return {
        ok: false,
        error: `You hold ${Number(formatUnits(balance, meta.decimals)).toLocaleString()} ${
          meta.symbol
        }, which is less than that.`,
      };
    }
  }

  const quoted = await quoteSwap(provider, quoter, {
    tokenIn: isBuy ? quote.address : token,
    tokenOut: isBuy ? token : quote.address,
    amountIn,
    fee: poolFee,
  });

  if (!quoted.ok) {
    return {
      ok: false,
      error: `The pool could not quote this trade: ${quoted.reason}`,
      hint: isBuy
        ? "Liquidity may be too thin for this size. Try a smaller amount."
        : "A sell that cannot even be quoted is the classic honeypot signature — run `audit` on this token before doing anything else.",
    };
  }

  const amountOut = quoted.amountOut;
  const slippageBps = BigInt(Math.round(Math.min(50, Math.max(0.1, slippagePercent)) * 100));
  const minOut = (amountOut * (10_000n - slippageBps)) / 10_000n;

  const params = {
    tokenIn: isBuy ? quote.address : token,
    tokenOut: isBuy ? token : quote.address,
    fee: poolFee,
    // Filled in at signing time when the terminal does not yet know the wallet.
    recipient: owner || "0x0000000000000000000000000000000000000000",
    deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  };

  // Amounts on the quote-asset side, in whole units of whatever it is (ETH for a
  // launch, USDG for a stock). `quoteIn`/`quoteOut` are the general form; `ethIn`/
  // `ethOut` stay populated only for the native pair so nothing reading them breaks.
  const quoteIn = isBuy ? Number(formatUnits(amountIn, quote.decimals)) : null;
  const quoteOut = isBuy ? null : Number(formatUnits(amountOut, quote.decimals));
  const tokensIn = isBuy ? null : Number(formatUnits(amountIn, meta.decimals));
  const tokensOut = isBuy ? Number(formatUnits(amountOut, meta.decimals)) : null;
  const ethIn = quote.isNative ? quoteIn : null;
  const ethOut = quote.isNative ? quoteOut : null;

  // A stablecoin is ~1 USD, so its amount IS the dollar figure; the native pair
  // converts through the live ETH/USD rate as before.
  const usdIn = quote.isStable ? quoteIn : ethIn != null && ethUsd ? ethIn * ethUsd : null;
  const usdOut = quote.isStable ? quoteOut : ethOut != null && ethUsd ? ethOut * ethUsd : null;

  // Effective price actually paid, including fee and impact — the number that
  // matters, and not the same as the pool's mid price. Denominated in the quote
  // asset; for a stock that is dollars directly.
  const execPriceQuote = isBuy
    ? tokensOut > 0
      ? quoteIn / tokensOut
      : null
    : tokensIn > 0
      ? quoteOut / tokensIn
      : null;

  return {
    ok: true,
    plan: {
      side,
      token,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
      poolFee,
      basis: resolved.basis,
      slippagePercent,

      // What this trade is paired against, so the executor and UI settle in the
      // same asset the quote was taken in.
      quoteId: quote.id,
      quoteSymbol: quote.symbol,
      quoteAddress: quote.address,
      quoteDecimals: quote.decimals,
      quoteIsNative: quote.isNative,
      quoteIsStable: quote.isStable,

      amountInRaw: amountIn.toString(),
      amountOutRaw: amountOut.toString(),
      minOutRaw: minOut.toString(),

      ethIn,
      ethOut,
      quoteIn,
      quoteOut,
      tokensIn,
      tokensOut,
      usdIn,
      usdOut,

      executionPriceWeth: quote.isNative ? execPriceQuote : null,
      executionPriceQuote: execPriceQuote,
      // A dollar-per-token figure the UI can show without an ETH rate.
      executionPriceUsd: quote.isStable
        ? execPriceQuote
        : execPriceQuote != null && ethUsd
          ? execPriceQuote * ethUsd
          : null,

      // A native buy pays ETH as msg.value and the router wraps it, so no
      // approval. A stablecoin buy spends an ERC-20 and must approve it first,
      // exactly like every sell.
      needsApproval: !isBuy || !quote.isNative,
      router: swapRouter,
      weth: quote.address,
      tx: {
        to: swapRouter,
        data: routerIface.encodeFunctionData("exactInputSingle", [params]),
        value: isBuy && quote.isNative ? "0x" + amountIn.toString(16) : "0x0",
      },
      approvalTx:
        !isBuy || !quote.isNative
          ? {
              // A sell approves the token being sold; a stablecoin buy approves
              // the stablecoin it spends.
              to: isBuy ? quote.address : token,
              data: erc20Iface.encodeFunctionData("approve", [swapRouter, amountIn]),
              value: "0x0",
            }
          : null,
    },
  };
}

/**
 * Re-encode a plan's swap for a known recipient.
 *
 * The plan is built before a wallet is necessarily known, so the recipient may
 * be the zero address. Sending that would burn the output, hence this exists and
 * hence the executor never sends `plan.tx` unchanged.
 */
function encodeSwap({ tokenIn, tokenOut, fee, recipient, amountIn, minOut, deadline }) {
  return routerIface.encodeFunctionData("exactInputSingle", [
    {
      tokenIn,
      tokenOut,
      fee,
      recipient: getAddress(recipient),
      deadline: deadline || Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
      amountIn: BigInt(amountIn),
      amountOutMinimum: BigInt(minOut),
      sqrtPriceLimitX96: 0n,
    },
  ]);
}

/**
 * A live price for a token that is NOT in the launch feed — a stock token, or
 * anything pasted by address. The feed carries pool state for its own launches;
 * for everything else we ask the pool the same question a trade would: "sell one
 * token, how much of the paired asset comes back?" That answer, times supply, is
 * a market cap.
 *
 * A launch is quoted against WETH; a stock (`kind: "stock"`) against USDG, since
 * that is the pool it actually has. A stablecoin answer IS a dollar price, so it
 * needs no ETH/USD rate.
 *
 * Returns `{ok:false}` rather than throwing when there is no pool to quote
 * against, and the caller turns that into a plain message.
 */
async function spotPrice(provider, chain, tokenInput, { ethUsd = null, kind = null } = {}) {
  const token = getAddress(tokenInput);
  const { quoter, poolFee } = chain.pons || {};
  const quoteAsset = quoteAssetFor(chain, kind);
  if (!quoteAsset.address || !quoter) return { ok: false, reason: "no quoter configured" };

  const meta = await tokenMeta(provider, token);
  const one = parseUnits("1", meta.decimals);
  const quoteDecimals = quoteAsset.isNative
    ? 18
    : (await tokenMeta(provider, quoteAsset.address)).decimals;

  const sold = await quoteSwap(provider, quoter, {
    tokenIn: token,
    tokenOut: quoteAsset.address,
    amountIn: one,
    fee: poolFee,
  });
  if (!sold.ok) return { ok: false, reason: sold.reason, meta };

  const priceInQuote = Number(formatUnits(sold.amountOut, quoteDecimals));
  // A stablecoin quote is already in dollars; a WETH quote converts through the
  // live rate if we have one.
  const priceUsd = quoteAsset.isStable ? priceInQuote : ethUsd ? priceInQuote * ethUsd : null;
  // Kept for launches so existing callers reading `priceInWeth`/`marketCapWeth`
  // are unchanged; null for a stablecoin pair, which has no WETH price.
  const priceInWeth = quoteAsset.isNative ? priceInQuote : null;

  let supplyTokens = null;
  try {
    const erc20 = new Contract(token, ERC20_ABI, provider);
    const supply = await erc20.totalSupply();
    supplyTokens = Number(formatUnits(supply, meta.decimals));
  } catch {
    /* a token with no readable supply still has a price */
  }

  return {
    ok: true,
    token,
    symbol: meta.symbol,
    name: meta.name,
    decimals: meta.decimals,
    quoteSymbol: quoteAsset.symbol,
    quoteIsStable: quoteAsset.isStable,
    priceInQuote,
    priceInWeth,
    priceUsd,
    supplyTokens,
    marketCapWeth: priceInWeth != null && supplyTokens != null ? priceInWeth * supplyTokens : null,
    marketCapUsd: priceUsd != null && supplyTokens != null ? priceUsd * supplyTokens : null,
  };
}

/**
 * Build a transfer — native ETH or an ERC-20 — out of the caller's wallet.
 *
 * Like a trade, the calldata handed back is the exact bytes that will be signed,
 * and the amount is resolved from the balance so `send all pons` means the whole
 * position to the wei. The balance is checked here so an overspend is a message,
 * not a reverted transaction that still costs gas.
 *
 * @returns {Promise<{ok:true, plan:object}|{ok:false, error:string}>}
 */
async function buildSendPlan(provider, chain, options) {
  const { asset, token: tokenInput, amount, owner, to } = options;
  if (!owner) {
    return { ok: false, error: "No wallet to send from — connect one or sign in with X first." };
  }
  const recipient = getAddress(to);

  if (asset === "native") {
    const balance = await provider.getBalance(owner);
    const amountRaw = parseEther(String(amount.value));
    if (amountRaw <= 0n) return { ok: false, error: "That amount comes out as zero." };
    // Leave a little headroom for gas rather than letting the send eat it and
    // revert. A fixed floor is crude but predictable on a cheap L2.
    if (balance <= amountRaw) {
      return {
        ok: false,
        error: `You hold ${Number(formatEther(balance)).toLocaleString("en-US", {
          maximumFractionDigits: 6,
        })} ETH, which does not cover ${amount.value} ETH plus gas.`,
      };
    }
    return {
      ok: true,
      plan: {
        kind: "send",
        asset: "native",
        to: recipient,
        symbol: chain.gasSymbol || "ETH",
        decimals: 18,
        amountRaw: amountRaw.toString(),
        amountLabel: `${Number(formatEther(amountRaw)).toLocaleString("en-US", {
          maximumFractionDigits: 6,
        })} ${chain.gasSymbol || "ETH"}`,
        tx: { to: recipient, data: "0x", value: "0x" + amountRaw.toString(16) },
      },
    };
  }

  // An ERC-20 transfer.
  const token = getAddress(tokenInput);
  const meta = await tokenMeta(provider, token);
  const balance = await tokenBalance(provider, token, owner);
  if (balance === 0n) return { ok: false, error: `That wallet holds no ${meta.symbol}.` };

  let amountRaw;
  if (amount.unit === "percent") {
    amountRaw = (balance * BigInt(Math.round(amount.value * 100))) / 10_000n;
  } else {
    amountRaw = parseUnits(String(amount.value), meta.decimals);
  }
  if (amountRaw <= 0n) return { ok: false, error: "That amount comes out as zero." };
  if (balance < amountRaw) {
    return {
      ok: false,
      error: `You hold ${Number(formatUnits(balance, meta.decimals)).toLocaleString(
        "en-US"
      )} ${meta.symbol}, which is less than that.`,
    };
  }

  return {
    ok: true,
    plan: {
      kind: "send",
      asset: "token",
      token,
      to: recipient,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
      amountRaw: amountRaw.toString(),
      amountLabel: `${Number(formatUnits(amountRaw, meta.decimals)).toLocaleString("en-US")} ${
        meta.symbol
      }`,
      tx: {
        to: token,
        data: erc20Iface.encodeFunctionData("transfer", [recipient, amountRaw]),
        value: "0x0",
      },
    },
  };
}

module.exports = {
  buildTradePlan,
  buildSendPlan,
  spotPrice,
  quoteAssetFor,
  encodeSwap,
  tokenMeta,
  tokenBalance,
  resolveAmountIn,
  routerIface,
  erc20Iface,
  ROUTER_ABI,
  ERC20_ABI,
  DEADLINE_SECONDS,
};
