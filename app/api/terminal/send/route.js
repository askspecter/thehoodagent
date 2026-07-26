import { NextResponse } from "next/server";
import { Contract, formatEther, formatUnits, getAddress, isAddress } from "ethers";
import { ERC20_ABI, deriveSigner, getChain, tokenMeta } from "@/lib/engine";
import { getSession } from "@/lib/session";

/**
 * POST /api/terminal/send — move funds out of the caller's X wallet.
 *
 * A sibling of /execute, and safe for the same reason: the wallet is derived
 * from the SESSION, so a request can only ever spend the caller's own funds. The
 * recipient DOES come from the request here — that is the whole point of a
 * transfer — but nothing else does, and the amount is bounded by the balance.
 *
 * Native sends and ERC-20 sends both dry-run before they broadcast, so a send
 * that would revert costs nothing.
 */

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { asset, token: tokenInput, amountRaw, to, network = "robinhood" } = body || {};

  if (asset !== "native" && asset !== "token") {
    return NextResponse.json({ error: "`asset` must be \"native\" or \"token\"." }, { status: 400 });
  }
  if (!to || !isAddress(to)) {
    return NextResponse.json({ error: "A valid recipient address is required." }, { status: 400 });
  }
  if (asset === "token" && (!tokenInput || !isAddress(tokenInput))) {
    return NextResponse.json({ error: "A valid token address is required." }, { status: 400 });
  }

  let amount;
  try {
    amount = BigInt(amountRaw);
  } catch {
    return NextResponse.json({ error: "`amountRaw` must be an integer string." }, { status: 400 });
  }
  if (amount <= 0n) {
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
      { error: "Sign in with X first — this sends from the wallet derived from your account." },
      { status: 401 }
    );
  }

  let chain;
  try {
    chain = getChain(network);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  let signer;
  try {
    signer = deriveSigner(session.id, chain);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const owner = await signer.getAddress();
  const recipient = getAddress(to);
  const provider = signer.provider;

  try {
    if (asset === "native") {
      const balance = await provider.getBalance(owner);
      if (balance <= amount) {
        return NextResponse.json(
          {
            error: `Your X wallet holds ${Number(formatEther(balance)).toLocaleString("en-US", {
              maximumFractionDigits: 6,
            })} ETH, which does not cover that plus gas.`,
          },
          { status: 400 }
        );
      }

      // Dry run: estimateGas runs the transfer against current state.
      try {
        await provider.estimateGas({ from: owner, to: recipient, value: amount });
      } catch (error) {
        return NextResponse.json(
          { error: `Simulation failed, so nothing was sent: ${error.shortMessage || error.message}` },
          { status: 400 }
        );
      }

      const tx = await signer.sendTransaction({ to: recipient, value: amount });
      const receipt = await tx.wait();
      if (receipt.status === 0) {
        return NextResponse.json(
          { error: "The transfer was mined but reverted.", hash: tx.hash },
          { status: 400 }
        );
      }
      return NextResponse.json({
        ok: true,
        hash: tx.hash,
        asset: "native",
        to: recipient,
        amountRaw: amount.toString(),
        explorer: chain.explorer,
      });
    }

    // ERC-20 transfer.
    const token = getAddress(tokenInput);
    const meta = await tokenMeta(provider, token);
    const erc20 = new Contract(token, ERC20_ABI, signer);

    const balance = await erc20.balanceOf(owner);
    if (balance < amount) {
      return NextResponse.json(
        {
          error: `Your X wallet holds ${Number(formatUnits(balance, meta.decimals)).toLocaleString(
            "en-US"
          )} ${meta.symbol}, which is less than that.`,
        },
        { status: 400 }
      );
    }

    try {
      await erc20.transfer.staticCall(recipient, amount);
    } catch (error) {
      return NextResponse.json(
        {
          error: `Simulation reverted, so nothing was sent: ${
            error.shortMessage || error.reason || error.message
          }`,
        },
        { status: 400 }
      );
    }

    const tx = await erc20.transfer(recipient, amount);
    const receipt = await tx.wait();
    if (receipt.status === 0) {
      return NextResponse.json(
        { error: "The transfer was mined but reverted.", hash: tx.hash },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      hash: tx.hash,
      asset: "token",
      token,
      symbol: meta.symbol,
      to: recipient,
      amountRaw: amount.toString(),
      explorer: chain.explorer,
    });
  } catch (error) {
    console.error("Terminal send failed:", error);
    const message = error.shortMessage || error.reason || error.message || "The transfer failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
