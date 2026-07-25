import { NextResponse } from "next/server";
import { getChain, discoverLaunchFunction } from "@/lib/engine";

/**
 * GET /api/factory?network=robinhood
 *
 * Returns the pons factory's launch entrypoint, discovered from its verified ABI
 * on the block explorer. The client uses this to build the launch form and encode
 * the call, so nothing about the signature is hardcoded or guessed.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const network = url.searchParams.get("network") || "robinhood";

  let chain;
  try {
    chain = getChain(network);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const factory = chain.pons?.factory;
  if (!factory || !chain.explorer) {
    return NextResponse.json(
      { error: "This network has no pons factory or explorer configured." },
      { status: 400 }
    );
  }

  try {
    const discovered = await discoverLaunchFunction(chain.explorer, factory);
    return NextResponse.json({
      network,
      factory,
      explorer: chain.explorer,
      chainId: chain.chainId,
      weth: chain.pons.weth,
      poolFee: chain.pons.poolFee,
      launchFeeEth: chain.pons.launchFeeEth,
      swapRouter: chain.pons.swapRouter,
      quoter: chain.pons.quoter,
      ...discovered,
    });
  } catch (error) {
    console.error("Factory ABI discovery failed:", error);
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
