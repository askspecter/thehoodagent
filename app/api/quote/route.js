import { NextResponse } from "next/server";
import { Contract, JsonRpcProvider, formatEther, formatUnits, parseEther, parseUnits } from "ethers";
import { getChain, quote as quoteSwap } from "@/lib/engine";

/**
 * POST /api/quote  { token, side: "buy"|"sell", amount, network }
 *
 * Quotes a swap through QuoterV2 so the UI can show the expected output before
 * anyone signs. Read-only — this spends nothing and grants no approval.
 */

const DECIMALS_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { token, side = "buy", amount, network = "robinhood", slippage = 5 } = body || {};
  if (!token || !amount) {
    return NextResponse.json({ error: "Provide `token` and `amount`." }, { status: 400 });
  }

  let chain;
  try {
    chain = getChain(network);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { weth, quoter, poolFee } = chain.pons || {};
  if (!weth || !quoter) {
    return NextResponse.json(
      { error: "This network has no pons quoter configured." },
      { status: 400 }
    );
  }

  try {
    const provider = new JsonRpcProvider(chain.rpc, chain.chainId);

    let decimals = 18;
    let symbol = "TOKEN";
    try {
      const meta = new Contract(token, DECIMALS_ABI, provider);
      decimals = Number(await meta.decimals());
      symbol = await meta.symbol();
    } catch {
      /* keep the 18/TOKEN defaults — a quote is still useful without metadata */
    }

    const isBuy = side === "buy";
    const amountIn = isBuy
      ? parseEther(String(amount))
      : parseUnits(String(amount), decimals);

    const result = await quoteSwap(provider, quoter, {
      tokenIn: isBuy ? weth : token,
      tokenOut: isBuy ? token : weth,
      amountIn,
      fee: poolFee,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: `The pool could not quote this trade: ${result.reason}`,
          hint: isBuy
            ? "Liquidity may be too thin for this size."
            : "A sell that cannot even be quoted is the classic honeypot signature — run the audit.",
        },
        { status: 400 }
      );
    }

    const amountOut = result.amountOut;

    // The floor the UI shows. It used to be absent from this response entirely,
    // so the "minimum out" tile read "—" on every quote — the one figure that
    // says how bad the fill is allowed to get.
    const slippageBps = BigInt(
      Math.round(Math.min(50, Math.max(0.1, Number(slippage) || 5)) * 100)
    );
    const minOut = (amountOut * (10_000n - slippageBps)) / 10_000n;

    const label = (raw, isEth) =>
      isEth
        ? `${Number(formatEther(raw)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`
        : `${Number(formatUnits(raw, decimals)).toLocaleString("en-US")} ${symbol}`;

    return NextResponse.json({
      side,
      symbol,
      decimals,
      amountInRaw: amountIn.toString(),
      amountOutRaw: amountOut.toString(),
      minOutRaw: minOut.toString(),
      amountInLabel: label(amountIn, isBuy),
      amountOutLabel: label(amountOut, !isBuy),
      minOutLabel: label(minOut, !isBuy),
      slippagePercent: Number(slippage) || 5,
      poolFee,
    });
  } catch (error) {
    console.error("Quote failed:", error);
    return NextResponse.json({ error: error.message || "Quote failed." }, { status: 502 });
  }
}
