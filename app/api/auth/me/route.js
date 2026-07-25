import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { xConfig } from "@/lib/xauth";

/**
 * Who is signed in, plus enough setup detail for the UI to explain a broken
 * sign-in instead of just failing at it.
 *
 * `setup` names the missing variables and echoes the callback URL this
 * deployment will use. Neither is a secret — the callback URL is public by
 * construction, and knowing that `X_CLIENT_SECRET` is unset tells an attacker
 * only that sign-in does not work, which they can already see. Values are never
 * returned.
 */
export async function GET(request) {
  const config = xConfig(request);
  const setup = {
    missing: config.missing,
    callbackUrl: config.redirectUri,
    callbackSource: config.redirectUriSource,
  };

  try {
    const user = await getSession();
    return NextResponse.json({ user, configured: config.configured, setup });
  } catch (error) {
    // A missing SESSION_SECRET should surface as a clear setup message, not a 500.
    return NextResponse.json({
      user: null,
      configured: false,
      setup,
      error: error.message,
    });
  }
}
