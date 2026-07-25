import crypto from "node:crypto";
import { cookies } from "next/headers";

/**
 * Minimal stateless sessions: a JSON payload plus an HMAC signature, stored in
 * an httpOnly cookie. No database needed.
 *
 * The signature is what makes this safe — a user can read their own cookie but
 * cannot change the X handle inside it without knowing SESSION_SECRET.
 */

const COOKIE = "pons_session";
const OAUTH_COOKIE = "pons_oauth";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Generate one with:\n" +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
        "and put it in web/.env.local"
    );
  }
  return value;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  // Constant-time compare so the signature cannot be brute-forced byte by byte.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

const baseCookie = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function setSession(user) {
  const store = await cookies();
  const payload = { ...user, exp: Date.now() + MAX_AGE * 1000 };
  store.set(COOKIE, sign(payload), { ...baseCookie, maxAge: MAX_AGE });
}

export async function getSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  return token ? verify(token) : null;
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

/** Short-lived cookie holding the PKCE verifier + CSRF state during OAuth. */
export async function setOAuthState(data) {
  const store = await cookies();
  store.set(OAUTH_COOKIE, sign({ ...data, exp: Date.now() + 10 * 60 * 1000 }), {
    ...baseCookie,
    maxAge: 600,
  });
}

export async function takeOAuthState() {
  const store = await cookies();
  const token = store.get(OAUTH_COOKIE)?.value;
  store.delete(OAUTH_COOKIE);
  return token ? verify(token) : null;
}

export { sign, verify };
