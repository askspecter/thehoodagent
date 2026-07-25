import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { setOAuthState } from "@/lib/session";

/**
 * Step 1 of X (Twitter) OAuth 2.0 with PKCE.
 *
 * PKCE means we send a hash of a secret now, and the secret itself when we
 * redeem the code. An attacker who intercepts the redirect cannot exchange the
 * code without the verifier, which never leaves our httpOnly cookie.
 */
export async function GET(request) {
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error: "X sign-in is not configured.",
        hint: "Set X_CLIENT_ID, X_CLIENT_SECRET and X_REDIRECT_URI in web/.env.local. See web/README.md.",
      },
      { status: 500 }
    );
  }

  // PKCE pair
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // CSRF token — the callback refuses any state it did not issue.
  const state = crypto.randomBytes(16).toString("base64url");

  await setOAuthState({ codeVerifier, state });

  const authorize = new URL("https://x.com/i/oauth2/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", "users.read tweet.read");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  return NextResponse.redirect(authorize.toString());
}
