import { NextResponse } from "next/server";
import { JsonRpcProvider } from "ethers";
import { getChain, getEthUsd, listLaunches } from "@/lib/engine";

/**
 * GET /api/launches?network=robinhood&limit=12
 *
 * The launchpad feed, read straight off the pons factory's TokenLaunched event.
 * No sign-in: this is public on-chain data and the page's front door.
 */

function serialise(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

export async function GET(request) {
  const url = new URL(request.url);
  const network = url.searchParams.get("network") || "robinhood";
  const limit = Math.min(Number(url.searchParams.get("limit") || 12), 24);

  let chain;
  try {
    chain = getChain(network);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  try {
    const provider = new JsonRpcProvider(chain.rpc, chain.chainId);
    // The rate is fetched alongside the feed, not after it: prices and market
    // caps are unreadable in WETH, and a second round trip would show the feed
    // twice — once priced in Ξ, then again in dollars.
    const [feed, rate] = await Promise.all([
      listLaunches(provider, chain, {
        limit,
        maxBlocks: Number(process.env.LAUNCH_SCAN_BLOCKS || 60_000),
      }),
      getEthUsd(),
    ]);
    return NextResponse.json(
      serialise({
        ...feed,
        network,
        explorer: chain.explorer,
        ethUsd: rate?.usd ?? null,
        ethUsdStale: rate?.stale ?? false,
      })
    );
  } catch (error) {
    console.error("Launch feed failed:", error);
    const unreachable = /fetch|network|ECONN|timeout|ENOTFOUND/i.test(error.message || "");
    return NextResponse.json(
      {
        error: error.message || "Could not load launches.",
        hint: unreachable
          ? "The Robinhood Chain RPC is unreachable from this server. Check ROBINHOOD_RPC."
          : undefined,
      },
      { status: unreachable ? 502 : 500 }
    );
  }
}
