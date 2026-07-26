import { NextResponse } from "next/server";
import { JsonRpcProvider } from "ethers";
import {
  recordLaunch,
  listLaunched,
  enrichLaunchesByAddress,
  getChain,
  getEthUsd,
} from "@/lib/engine";

/**
 * GET  /api/registry        → tokens launched through this site, newest first
 * POST /api/registry        → record one after its launch transaction confirms
 *
 * The chain cannot tell us which front end was used for a launch, so this is how
 * "launched here" is known at all.
 *
 * The addresses come from the registry, but the live state (name, price, market
 * cap, graduation) is read straight off the chain here. That is what makes a
 * just-created token appear the instant it exists, rather than waiting for it to
 * bubble into the top of the general feed's bounded block window.
 */

function serialise(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

export async function GET(request) {
  const url = new URL(request.url);
  const network = url.searchParams.get("network") || "robinhood";

  try {
    const result = await listLaunched({ limit: 50 });

    let launches = [];
    let ethUsd = null;
    if (result.tokens.length) {
      const chain = getChain(network);
      const provider = new JsonRpcProvider(chain.rpc, chain.chainId);
      const [enriched, rate] = await Promise.all([
        enrichLaunchesByAddress(provider, chain, result.tokens),
        getEthUsd(),
      ]);
      launches = enriched;
      ethUsd = rate?.usd ?? null;
    }

    return NextResponse.json(serialise({ ...result, launches, ethUsd, network }));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { token, txHash, deployer } = body || {};
  if (!token) {
    return NextResponse.json({ error: "Provide a `token` address." }, { status: 400 });
  }

  try {
    const result = await recordLaunch(token, { txHash, deployer });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
