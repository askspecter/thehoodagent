import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { setOAuthState } from "@/lib/session";
import { publicOrigin, xConfig } from "@/lib/xauth";

/**
 * Step 1 of X (Twitter) OAuth 2.0 with PKCE.
 *
 * PKCE means we send a hash of a secret now, and the secret itself when we
 * redeem the code. An attacker who intercepts the redirect cannot exchange the
 * code without the verifier, which never leaves our httpOnly cookie.
 */
export async function GET(request) {
  const config = xConfig(request);
  const home = new URL("/", publicOrigin(request));

  if (!config.configured) {
    // This used to answer a browser with a raw JSON 500, which is what a visitor
    // saw instead of a sign-in page. Send them back to the app with a code it
    // knows how to explain, and list what is missing so it can be fixed.
    home.searchParams.set("auth_error", "not_configured");
    home.searchParams.set("missing", config.missing.join(","));
    return NextResponse.redirect(home);
  }

  // PKCE pair
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // CSRF token — the callback refuses any state it did not issue.
  const state = crypto.randomBytes(16).toString("base64url");

  try {
    // The redirect URI is pinned into the cookie: the token exchange must send
    // back the exact string X saw here, and deriving it twice from two different
    // requests is how that quietly stops matching.
    await setOAuthState({ codeVerifier, state, redirectUri: config.redirectUri });
  } catch (error) {
    console.error("Could not start X sign-in:", error);
    home.searchParams.set("auth_error", "not_configured");
    home.searchParams.set("missing", "SESSION_SECRET");
    return NextResponse.redirect(home);
  }

  const authorize = new URL("https://x.com/i/oauth2/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("scope", "users.read tweet.read");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  return NextResponse.redirect(authorize.toString());
}
