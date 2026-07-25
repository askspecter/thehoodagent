import { NextResponse } from "next/server";
import { derivePrivateKey } from "@/lib/engine";
import { getSession } from "@/lib/session";

/**
 * POST /api/wallet/export
 *
 * Returns the signed-in user's private key so they can move the wallet into
 * MetaMask or anywhere else. This is the "not your keys" escape hatch: the wallet
 * is derived from the X account, and this is how its owner takes full control.
 *
 * POST rather than GET on purpose — a GET can be triggered by a link, an image
 * tag or a prefetch, and land a private key in browser history, referrer headers
 * and server logs. It is also never cached.
 */
export async function POST() {
  let session;
  try {
    session = await getSession();
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!session) {
    return NextResponse.json({ error: "Sign in with X first." }, { status: 401 });
  }

  try {
    const privateKey = derivePrivateKey(session.id);
    return NextResponse.json(
      {
        privateKey,
        handle: session.username,
        warning:
          "Anyone with this key controls the wallet completely. Never paste it into a website, a chat, or a support DM — and remember it stays valid even after you sign out here.",
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
