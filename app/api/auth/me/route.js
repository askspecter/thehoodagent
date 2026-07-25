import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  try {
    const user = await getSession();
    return NextResponse.json({
      user,
      configured: Boolean(process.env.X_CLIENT_ID && process.env.X_REDIRECT_URI),
    });
  } catch (error) {
    // A missing SESSION_SECRET should surface as a clear setup message, not a 500.
    return NextResponse.json({ user: null, configured: false, error: error.message });
  }
}
