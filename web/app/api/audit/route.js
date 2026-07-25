import { NextResponse } from "next/server";
import { auditToken, getChain, scoreReport } from "@pons/engine";
import { getSession } from "@/lib/session";

/**
 * POST /api/audit  { address, network?, probeEth? }
 *
 * Runs the read-only audit server-side. Doing it on the server (rather than in
 * the browser) keeps the RPC endpoint and any API keys out of client code, and
 * means one warm connection serves every visitor.
 */

// Simple per-user throttle. NOTE: in-memory, so it resets on restart and does
// not span multiple server instances. Swap for Redis before real traffic.
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

function rateLimited(key) {
  const now = Date.now();
  const record = hits.get(key);
  if (!record || now > record.reset) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  record.count += 1;
  return record.count > MAX_PER_WINDOW;
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
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!session) {
    return NextResponse.json(
      { error: "Sign in with X to run an audit." },
      { status: 401 }
    );
  }

  if (rateLimited(session.id)) {
    return NextResponse.json(
      { error: `Slow down — max ${MAX_PER_WINDOW} audits per minute.` },
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
    return NextResponse.json(serialise({ ...report, score }));
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
