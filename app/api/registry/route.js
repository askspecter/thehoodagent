import { NextResponse } from "next/server";
import { recordLaunch, listLaunched } from "@/lib/engine";

/**
 * GET  /api/registry        → tokens launched through this site, newest first
 * POST /api/registry        → record one after its launch transaction confirms
 *
 * The chain cannot tell us which front end was used for a launch, so this is how
 * "launched here" is known at all.
 */

export async function GET() {
  try {
    const result = await listLaunched({ limit: 50 });
    return NextResponse.json(result);
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
