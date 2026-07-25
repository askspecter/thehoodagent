/**
 * X (Twitter) OAuth configuration, resolved in one place.
 *
 * Sign-in was failing on the deployed site for the most ordinary reason there
 * is: `X_REDIRECT_URI` was either unset or pointed at localhost, and the login
 * route answered a browser with a raw JSON 500. Two things change here.
 *
 *  1. The callback URL is DERIVED from the request when it is not configured.
 *     It has to match what X has registered exactly, and the deployment already
 *     knows its own origin — asking an operator to retype it into an env var is
 *     one more thing to get wrong. Setting `X_REDIRECT_URI` still wins, because
 *     a proxy or a custom domain can make the request origin the wrong answer.
 *
 *  2. Both the login and the callback leg call the SAME resolver. X compares the
 *     `redirect_uri` sent at authorize time with the one sent at token-exchange
 *     time and rejects the exchange if they differ, so these two must never be
 *     allowed to drift apart.
 */

export const CALLBACK_PATH = "/api/auth/x/callback";

/**
 * The public origin of this deployment.
 *
 * Behind Vercel's proxy `request.url` is the internal URL, so the forwarded
 * headers are the authoritative source. They are only trusted for building a
 * redirect back to ourselves — never for an access decision — and X rejects any
 * callback it has not been given in advance, which is the real backstop.
 */
export function publicOrigin(request) {
  const explicit = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (explicit) return explicit.replace(/\/+$/, "");

  const headers = request?.headers;
  const forwardedHost = headers?.get("x-forwarded-host") || headers?.get("host");
  const forwardedProto = headers?.get("x-forwarded-proto");

  if (forwardedHost) {
    const proto =
      forwardedProto || (forwardedHost.startsWith("localhost") ? "http" : "https");
    return `${proto}://${forwardedHost}`;
  }

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  try {
    return new URL(request.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

/**
 * Everything the OAuth legs need, plus an honest account of what is missing.
 *
 * @returns {{clientId?: string, clientSecret?: string, redirectUri: string,
 *            redirectUriSource: "env"|"derived", configured: boolean,
 *            missing: string[]}}
 */
export function xConfig(request) {
  const clientId = process.env.X_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.X_CLIENT_SECRET?.trim() || null;
  const envRedirect = process.env.X_REDIRECT_URI?.trim() || null;

  const redirectUri = envRedirect || `${publicOrigin(request)}${CALLBACK_PATH}`;

  const missing = [];
  if (!clientId) missing.push("X_CLIENT_ID");
  // A confidential ("Web App") X client cannot exchange a code without its
  // secret, and that is the app type the callback URL below requires.
  if (!clientSecret) missing.push("X_CLIENT_SECRET");
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    missing.push("SESSION_SECRET");
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    redirectUriSource: envRedirect ? "env" : "derived",
    configured: missing.length === 0,
    missing,
  };
}
