import { NextResponse } from "next/server";
import { auditToken, getChain, getEthUsd, scoreReport } from "@/lib/engine";
import { getSession } from "@/lib/session";

/**
 * POST /api/audit  { address, network?, probeEth? }
 *
 * Runs the read-only audit server-side. Doing it on the server (rather than in
 * the browser) keeps the RPC endpoint and any API keys out of client code, and
 * means one warm connection serves every visitor.
 */

// Throttle. NOTE: in-memory, so it resets on restart and does not span multiple
// server instances. Swap for Redis before real traffic.
const hits = new Map();
const WINDOW_MS = 60_000;

/**
 * Anyone may audit — the check is read-only and costs nothing to run, so gating
 * it behind sign-in would only make the tool useless to the person who most
 * needs it: someone about to buy a token they have not checked. Signing in with
 * X simply raises the ceiling.
 */
const LIMITS = { anonymous: 5, signedIn: 15 };

function rateLimited(key, max) {
  const now = Date.now();
  const record = hits.get(key);
  if (!record || now > record.reset) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  record.count += 1;
  return record.count > max;
}

/** Best-effort client identity for anonymous throttling. */
function clientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : null;
  return `ip:${ip || request.headers.get("x-real-ip") || "unknown"}`;
}

/** BigInt values cannot go through JSON.stringify, so widen them to strings. */
function serialise(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

export async function POST(request) {
  let session = null;
  try {
    session = await getSession();
  } catch {
    // A missing or bad SESSION_SECRET must not take the auditor down with it —
    // sign-in is an extra here, not a prerequisite. Continue as anonymous.
    session = null;
  }

  const max = session ? LIMITS.signedIn : LIMITS.anonymous;
  const key = session ? `user:${session.id}` : clientKey(request);

  if (rateLimited(key, max)) {
    return NextResponse.json(
      {
        error: `Slow down — max ${max} audits per minute.`,
        hint: session ? undefined : "Signing in with X raises the limit.",
      },
      { status: 429 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { address, network = "robinhood", probeEth = "0.01" } = payload || {};
  if (!address || typeof address !== "string") {
    return NextResponse.json({ error: "Provide a token `address`." }, { status: 400 });
  }

  let chain;
  try {
    chain = getChain(network);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  try {
    const report = await auditToken(address, chain, {
      probeEth,
      // Keep the log replay modest so a web request cannot hang for minutes.
      maxBlocks: Number(process.env.AUDIT_MAX_BLOCKS || 30_000),
    });
    const score = scoreReport(report);
    // Attached rather than baked into the report: the engine deals in WETH,
    // which is what the pool holds, and the dollar figure is presentation.
    const rate = await getEthUsd();
    return NextResponse.json(
      serialise({ ...report, score, ethUsd: rate?.usd ?? null, ethUsdStale: rate?.stale ?? false })
    );
  } catch (error) {
    console.error("Audit failed:", error);
    const unreachable = /fetch|network|ECONN|timeout|ENOTFOUND/i.test(error.message || "");
    return NextResponse.json(
      {
        error: error.message || "Audit failed.",
        hint: unreachable
          ? "The Robinhood Chain RPC is unreachable from this server. Check ROBINHOOD_RPC, and note that some hosting environments block outbound RPC."
          : undefined,
      },
      { status: unreachable ? 502 : 400 }
    );
  }
}
