import { NextResponse } from "next/server";
import { setSession, takeOAuthState } from "@/lib/session";

/** Step 2: X redirects here with a code. Exchange it, then load the profile. */
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const home = new URL("/", url.origin);

  if (oauthError) {
    home.searchParams.set("auth_error", oauthError);
    return NextResponse.redirect(home);
  }

  const saved = await takeOAuthState();
  if (!saved || !state || saved.state !== state) {
    // Either the cookie expired or someone replayed a callback at us.
    home.searchParams.set("auth_error", "state_mismatch");
    return NextResponse.redirect(home);
  }
  if (!code) {
    home.searchParams.set("auth_error", "missing_code");
    return NextResponse.redirect(home);
  }

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = process.env.X_REDIRECT_URI;

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
