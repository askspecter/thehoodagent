import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { kvConfigured } from "@/lib/engine";

/**
 * Logo upload.
 *
 * POST /api/logo        multipart file  → { url }
 * GET  /api/logo?id=…                   → the image bytes
 *
 * The factory stores the logo as a string, so it needs a URL rather than bytes.
 * Rather than asking a launcher to find their own image host, we keep the file
 * and hand back a URL on this domain.
 *
 * Storage is Upstash/Vercel KV. Without it there is nowhere durable to put the
 * bytes, and an image that vanishes on the next cold start would leave a launched
 * token with a permanently broken logo — so we refuse clearly instead.
 */

const MAX_BYTES = 512 * 1024; // 512 KB — a token logo has no business being larger
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const PREFIX = "pons:logo:";
const TTL_SECONDS = 60 * 60 * 24 * 365 * 5;

async function kv(command) {
  const url = `${process.env.KV_REST_API_URL.replace(/\/+$/, "")}/${command
    .map((p) => encodeURIComponent(p))
    .join("/")}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV ${command[0]} failed: HTTP ${res.status}`);
  return res.json();
}

export async function POST(request) {
  if (!kvConfigured()) {
    return NextResponse.json(
      {
        error:
          "Logo upload needs storage. Set KV_REST_API_URL and KV_REST_API_TOKEN, or paste an image URL instead.",
      },
      { status: 501 }
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file received." }, { status: 400 });
  }

  const type = file.type || "";
  if (!ALLOWED.has(type)) {
    return NextResponse.json(
      { error: `Unsupported image type "${type || "unknown"}". Use PNG, JPEG, WebP or GIF.` },
      { status: 415 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `Image is ${Math.round(bytes.length / 1024)} KB. Keep it under 512 KB.` },
      { status: 413 }
    );
  }

  const id = crypto.randomBytes(16).toString("hex");
  const payload = JSON.stringify({ type, data: bytes.toString("base64") });

  try {
    await kv(["set", PREFIX + id, payload, "ex", String(TTL_SECONDS)]);
  } catch (error) {
    return NextResponse.json({ error: `Could not store the image: ${error.message}` }, { status: 502 });
  }

  const origin = process.env.PUBLIC_ORIGIN || new URL(request.url).origin;
  return NextResponse.json({ id, url: `${origin}/api/logo?id=${id}`, bytes: bytes.length });
}

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }
  if (!kvConfigured()) {
    return NextResponse.json({ error: "Logo storage is not configured." }, { status: 501 });
  }

  try {
    const json = await kv(["get", PREFIX + id]);
    if (!json?.result) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const { type, data } = JSON.parse(json.result);
    return new NextResponse(Buffer.from(data, "base64"), {
      headers: {
        "Content-Type": type,
        // Immutable: the id is content-addressed by randomness and never reused.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
