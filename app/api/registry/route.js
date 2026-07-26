import { NextResponse } from "next/server";
import { JsonRpcProvider, getAddress } from "ethers";
import {
  recordLaunch,
  listLaunched,
  enrichLaunchesByAddress,
  deriveAddress,
  getChain,
  getEthUsd,
} from "@/lib/engine";
import { getSession } from "@/lib/session";

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

  // The viewer's own X handle + wallet, so a launch they made is credited to
  // them even when its registry entry predates handle-recording (or the
  // in-memory registry was reset). getSession may throw with no SESSION_SECRET;
  // that just means "no viewer", not an error worth failing the feed over.
  let me = null;
  try {
    const session = await getSession();
    if (session?.username && session?.id) {
      me = { handle: session.username.replace(/^@/, ""), wallet: getAddress(deriveAddress(session.id)) };
    }
  } catch {
    /* no viewer identity available */
  }

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

      // Credit the X handle that launched each token, matched by address.
      const handleByToken = new Map(
        (result.entries || [])
          .filter((e) => e.xUsername)
          .map((e) => [e.token.toLowerCase(), e.xUsername])
      );
      launches = enriched.map((l) => {
        const recorded = handleByToken.get(l.token.toLowerCase());
        // Fall back to the viewer's handle when they are the launch's deployer.
        const mine = me && l.deployer && getAddress(l.deployer) === me.wallet ? me.handle : null;
        return { ...l, xUsername: recorded || mine || null };
      });
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

  const { token, txHash, deployer, xUsername } = body || {};
  if (!token) {
    return NextResponse.json({ error: "Provide a `token` address." }, { status: 400 });
  }

  try {
    const result = await recordLaunch(token, { txHash, deployer, xUsername });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
