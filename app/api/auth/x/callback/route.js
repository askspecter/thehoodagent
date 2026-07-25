import { NextResponse } from "next/server";
import { setSession, takeOAuthState } from "@/lib/session";
import { publicOrigin, xConfig } from "@/lib/xauth";

/** Step 2: X redirects here with a code. Exchange it, then load the profile. */
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // Not `url.origin`: behind a proxy that is the internal host, and sending the
  // visitor there ends the sign-in on a hostname their browser cannot resolve.
  const home = new URL("/", publicOrigin(request));

  if (oauthError) {
    home.searchParams.set("auth_error", oauthError);
    return NextResponse.redirect(home);
  }

  let saved;
  try {
    saved = await takeOAuthState();
  } catch (error) {
    // Only ever a missing SESSION_SECRET, and it fails at exactly the point
    // where the visitor has already handed X their password. Name it.
    console.error("Could not read the OAuth state cookie:", error);
    home.searchParams.set("auth_error", "not_configured");
    home.searchParams.set("missing", "SESSION_SECRET");
    return NextResponse.redirect(home);
  }

  if (!saved || !state || saved.state !== state) {
    // Either the cookie expired or someone replayed a callback at us.
    home.searchParams.set("auth_error", "state_mismatch");
    return NextResponse.redirect(home);
  }
  if (!code) {
    home.searchParams.set("auth_error", "missing_code");
    return NextResponse.redirect(home);
  }

  const config = xConfig(request);
  const clientId = config.clientId;
  const clientSecret = config.clientSecret;
  // The URI the authorize step actually sent. X compares the two strings and
  // rejects the exchange on any difference, so re-deriving it here would be a
  // guess where the cookie holds the fact.
  const redirectUri = saved.redirectUri || config.redirectUri;

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: saved.codeVerifier,
      client_id: clientId,
    });

    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    // Confidential clients authenticate with HTTP Basic; public clients don't.
    if (clientSecret) {
      headers.Authorization =
        "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    }

    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body,
    });

    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text();
      console.error("X token exchange failed:", tokenResponse.status, detail);
      home.searchParams.set("auth_error", "token_exchange_failed");
      return NextResponse.redirect(home);
    }

    const { access_token } = await tokenResponse.json();

    const profileResponse = await fetch(
      "https://api.x.com/2/users/me?user.fields=profile_image_url,username,name",
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    if (!profileResponse.ok) {
      home.searchParams.set("auth_error", "profile_fetch_failed");
      return NextResponse.redirect(home);
    }

    const { data } = await profileResponse.json();

    // Only identity is stored. We deliberately do NOT keep the access token —
    // this app never posts on the user's behalf, so holding it would be a
    // liability with no benefit.
    await setSession({
      id: data.id,
      username: data.username,
      name: data.name,
      avatar: data.profile_image_url || null,
    });

    return NextResponse.redirect(home);
  } catch (error) {
    console.error("X OAuth callback error:", error);
    home.searchParams.set("auth_error", "unexpected");
    return NextResponse.redirect(home);
  }
}
