import { NextResponse } from "next/server";
import { deriveAddress, getChain, nativeBalance } from "@/lib/engine";
import { getSession } from "@/lib/session";

/**
 * GET /api/wallet?network=robinhood
 *
 * The signed-in user's X-derived wallet: address and balance. The private key is
 * never included here — that requires the explicit export endpoint.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const network = url.searchParams.get("network") || "robinhood";

  let session;
  try {
    session = await getSession();
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!session) {
    return NextResponse.json({ error: "Sign in with X first." }, { status: 401 });
  }

  let chain;
  try {
    chain = getChain(network);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  let address;
  try {
    address = deriveAddress(session.id);
  } catch (error) {
    // Almost always a missing WALLET_DERIVATION_SECRET — say so plainly.
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let balance = null;
  let balanceError = null;
  try {
    balance = await nativeBalance(address, chain);
  } catch (error) {
    balanceError = `Could not read the balance: ${error.message}`;
  }

  return NextResponse.json({
    address,
    handle: session.username,
    name: session.name,
    avatar: session.avatar,
    chain: chain.name,
    chainId: chain.chainId,
    explorer: chain.explorer,
    gasSymbol: chain.gasSymbol,
    balance,
    balanceError,
  });
}
