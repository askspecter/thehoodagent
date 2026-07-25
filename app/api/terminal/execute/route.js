import { NextResponse } from "next/server";
import { Contract, formatEther, formatUnits, getAddress, isAddress } from "ethers";
import {
  DEADLINE_SECONDS,
  ERC20_ABI,
  ROUTER_ABI,
  deriveSigner,
  getChain,
  quote,
  tokenMeta,
} from "@/lib/engine";
import { getSession } from "@/lib/session";

/**
 * POST /api/terminal/execute — sign and send a trade from the caller's X wallet.
 *
 * This is the only endpoint in the app that spends money, and it exists because
 * a phone has no wallet extension: without it, "buy me $5 nvda" is a sentence
 * the terminal can price and never fill.
 *
 * What keeps it safe is not that the client is trusted — it is that almost
 * nothing the client says is used:
 *
 *  • The wallet is derived from the SESSION, so a request can only ever spend
 *    the caller's own funds. No address is accepted from the body.
 *  • The recipient is that same derived address. Output cannot be redirected.
 *  • The router, WETH and fee tier come from server config, not the request.
 *  • The trade is re-quoted here and `amountOutMinimum` is computed from the
 *    FRESH quote. A stale plan from a browser tab left open for an hour cannot
 *    set its own floor.
 *  • If the fresh quote is materially worse than what the caller was shown, the
 *    trade is refused rather than filled at a price they never saw.
 *  • Every send is dry-run with `staticCall` first, so a revert costs nothing.
 */

/** Refuse rather than fill when the price has moved further than this. */
const MAX_DRIFT_BPS = 500n; // 5%

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const {
    token: tokenInput,
    side,
    amountInRaw,
    expectedOutRaw = null,
    slippage = 5,
    network = "robinhood",
  } = body || {};

  if (side !== "buy" && side !== "sell") {
    return NextResponse.json({ error: "`side` must be \"buy\" or \"sell\"." }, { status: 400 });
  }
  if (!tokenInput || !isAddress(tokenInput)) {
    return NextResponse.json({ error: "A valid token address is required." }, { status: 400 });
  }

  let amountIn;
  try {
    amountIn = BigInt(amountInRaw);
  } catch {
    return NextResponse.json({ error: "`amountInRaw` must be an integer string." }, { status: 400 });
  }
  if (amountIn <= 0n) {
    return NextResponse.json({ error: "Amount must be greater than zero." }, { status: 400 });
  }

  let session;
  try {
    session = await getSession();
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json(
      { error: "Sign in with X first — this signs with the wallet derived from your account." },
      { status: 401 }
    );
  }

  let chain;
  try {
    chain = getChain(network);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { weth, quoter, swapRouter, poolFee } = chain.pons || {};
  if (!weth || !quoter || !swapRouter) {
    return NextResponse.json(
      { error: "This network has no pons router configured." },
      { status: 400 }
    );
  }

  let signer;
  try {
    signer = deriveSigner(session.id, chain);
  } catch (error) {
    // Almost always a missing WALLET_DERIVATION_SECRET.
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const token = getAddress(tokenInput);
  const owner = await signer.getAddress();
  const isBuy = side === "buy";
  const provider = signer.provider;

  try {
    const meta = await tokenMeta(provider, token);
    const erc20 = new Contract(token, ERC20_ABI, signer);

    // ---- Can this wallet actually afford it? ----
    if (isBuy) {
      const balance = await provider.getBalance(owner);
      if (balance <= amountIn) {
        return NextResponse.json(
          {
            error: `Your X wallet holds ${Number(formatEther(balance)).toFixed(
              6
            )} ETH, which does not cover ${Number(formatEther(amountIn)).toFixed(
              6
            )} ETH plus gas.`,
            hint: "Send ETH to the address on the Wallet tab first.",
          },
          { status: 400 }
        );
      }
    } else {
      const balance = await erc20.balanceOf(owner);
      if (balance < amountIn) {
        return NextResponse.json(
          {
            error: `Your X wallet holds ${Number(
              formatUnits(balance, meta.decimals)
            ).toLocaleString("en-US")} ${meta.symbol}, which is less than that.`,
          },
          { status: 400 }
        );
      }
    }

    // ---- Re-quote. The floor is set from this, never from the request. ----
    const fresh = await quote(provider, quoter, {
      tokenIn: isBuy ? weth : token,
      tokenOut: isBuy ? token : weth,
      amountIn,
      fee: poolFee,
    });

    if (!fresh.ok) {
      return NextResponse.json(
        {
          error: `The pool will not quote this trade any more: ${fresh.reason}`,
          hint: isBuy
            ? "Liquidity may have moved. Try a smaller size."
            : "A sell that stops quoting is the honeypot signature. Run `audit` on this token.",
        },
        { status: 400 }
      );
    }

    if (expectedOutRaw) {
      let expected;
      try {
        expected = BigInt(expectedOutRaw);
      } catch {
        expected = 0n;
      }
      // Only a move AGAINST the caller is a problem; a better price is fine.
      if (expected > 0n && fresh.amountOut < (expected * (10_000n - MAX_DRIFT_BPS)) / 10_000n) {
        return NextResponse.json(
          {
            error:
              "The price moved more than 5% against you since that quote, so nothing was sent.",
            hint: "Run the command again to price it fresh.",
          },
          { status: 409 }
        );
      }
    }

    const slippageBps = BigInt(
      Math.round(Math.min(50, Math.max(0.1, Number(slippage) || 5)) * 100)
    );
    const minOut = (fresh.amountOut * (10_000n - slippageBps)) / 10_000n;

    // ---- Approval, for sells only ----
    let approvalHash = null;
    if (!isBuy) {
      const allowance = await erc20.allowance(owner, swapRouter);
      if (allowance < amountIn) {
        const approveTx = await erc20.approve(swapRouter, amountIn);
        approvalHash = approveTx.hash;
        await approveTx.wait();
      }
    }

    const router = new Contract(swapRouter, ROUTER_ABI, signer);
    const params = {
      tokenIn: isBuy ? weth : token,
      tokenOut: isBuy ? token : weth,
      fee: poolFee,
      recipient: owner,
      deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
      amountIn,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0n,
    };
    const overrides = isBuy ? { value: amountIn } : {};

    // ---- Dry run. A revert here costs nothing; on chain it costs gas. ----
    try {
      await router.exactInputSingle.staticCall(params, overrides);
    } catch (error) {
      return NextResponse.json(
        {
          error: `Simulation reverted, so nothing was sent: ${
            error.shortMessage || error.reason || error.message
          }`,
          hint: isBuy
            ? "The pool may be too thin for this size."
            : "A reverting sell is the classic honeypot signature — run `audit` on this token.",
          approvalHash,
        },
        { status: 400 }
      );
    }

    const tx = await router.exactInputSingle(params, overrides);
    const receipt = await tx.wait();

    if (receipt.status === 0) {
      return NextResponse.json(
        { error: "The swap was mined but reverted. Nothing changed hands.", hash: tx.hash },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      hash: tx.hash,
      approvalHash,
      owner,
      side,
      token,
      symbol: meta.symbol,
      amountInRaw: amountIn.toString(),
      quotedOutRaw: fresh.amountOut.toString(),
      minOutRaw: minOut.toString(),
      explorer: chain.explorer,
    });
  } catch (error) {
    console.error("Terminal execute failed:", error);
    const message = error.shortMessage || error.reason || error.message || "The trade failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
