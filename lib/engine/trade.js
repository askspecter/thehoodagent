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
const { quote } = require("./simulate");

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
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

const routerIface = new Interface(ROUTER_ABI);
const erc20Iface = new Interface(ERC20_ABI);

/** Twenty minutes is long enough for a slow confirm, short enough to expire. */
const DEADLINE_SECONDS = 20 * 60;

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
async function resolveAmountIn(provider, { side, amount, token, decimals, owner, ethUsd }) {
  const { unit, value } = amount;

  if (side === "buy") {
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
  } = options;

  const token = getAddress(tokenInput);
  const { weth, quoter, swapRouter, poolFee } = chain.pons || {};
  if (!weth || !quoter || !swapRouter) {
    return { ok: false, error: "This network has no pons router configured, so it cannot trade." };
  }

  const meta = await tokenMeta(provider, token);

  const resolved = await resolveAmountIn(provider, {
    side,
    amount,
    token,
    decimals: meta.decimals,
    owner,
    ethUsd,
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

  const quoted = await quote(provider, quoter, {
    tokenIn: isBuy ? weth : token,
    tokenOut: isBuy ? token : weth,
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
    tokenIn: isBuy ? weth : token,
    tokenOut: isBuy ? token : weth,
    fee: poolFee,
    // Filled in at signing time when the terminal does not yet know the wallet.
    recipient: owner || "0x0000000000000000000000000000000000000000",
    deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  };

  const ethIn = isBuy ? Number(formatEther(amountIn)) : null;
  const ethOut = isBuy ? null : Number(formatEther(amountOut));
  const tokensIn = isBuy ? null : Number(formatUnits(amountIn, meta.decimals));
  const tokensOut = isBuy ? Number(formatUnits(amountOut, meta.decimals)) : null;

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

      amountInRaw: amountIn.toString(),
      amountOutRaw: amountOut.toString(),
      minOutRaw: minOut.toString(),

      ethIn,
      ethOut,
      tokensIn,
      tokensOut,
      usdIn: ethIn != null && ethUsd ? ethIn * ethUsd : null,
      usdOut: ethOut != null && ethUsd ? ethOut * ethUsd : null,

      // Effective price actually paid, including fee and impact — the number
      // that matters, and not the same as the pool's mid price.
      executionPriceWeth: isBuy
        ? tokensOut > 0
          ? ethIn / tokensOut
          : null
        : tokensIn > 0
          ? ethOut / tokensIn
          : null,

      needsApproval: !isBuy,
      router: swapRouter,
      weth,
      tx: {
        to: swapRouter,
        data: routerIface.encodeFunctionData("exactInputSingle", [params]),
        value: isBuy ? "0x" + amountIn.toString(16) : "0x0",
      },
      approvalTx: isBuy
        ? null
        : {
            to: token,
            data: erc20Iface.encodeFunctionData("approve", [swapRouter, amountIn]),
            value: "0x0",
          },
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

module.exports = {
  buildTradePlan,
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
