"use strict";

const { getAddress } = require("ethers");
const { hiddenTokenSet, isHiddenToken } = require("./launches");

/**
 * Registry of tokens launched through THIS site.
 *
 * On-chain there is nothing to distinguish a launch made here from one made on
 * ponsfamily.com — the factory records the visitor's wallet as deployer either
 * way, which is correct but means the chain cannot tell us whose front end was
 * used. So we record it ourselves when a launch succeeds here.
 *
 * Storage is pluggable:
 *   • Upstash / Vercel KV REST if KV_REST_API_URL + KV_REST_API_TOKEN are set —
 *     survives restarts and is shared across serverless instances.
 *   • otherwise an in-memory set, which resets on cold start. Fine for a demo,
 *     not for production: set the KV variables before you expect the list to
 *     persist.
 */

const KEY = "pons:launched";
const memory = new Set();

function kvConfigured() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function kvHeaders() {
  return { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
}

async function kvCommand(command) {
  const url = `${process.env.KV_REST_API_URL.replace(/\/+$/, "")}/${command
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
  const res = await fetch(url, { headers: kvHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`KV ${command[0]} failed: HTTP ${res.status}`);
  return res.json();
}

/** Record a token as launched here. Idempotent. */
async function recordLaunch(tokenAddress, meta = {}) {
  const token = getAddress(tokenAddress);
  const entry = JSON.stringify({
    token,
    at: Date.now(),
    txHash: meta.txHash || null,
    deployer: meta.deployer ? getAddress(meta.deployer) : null,
    // The chain only knows the deployer wallet; the X handle is the human behind
    // it, so the feed can credit "@name" instead of a hex address for our launches.
    xUsername: typeof meta.xUsername === "string" ? meta.xUsername.replace(/^@/, "") : null,
  });

  if (kvConfigured()) {
    // A sorted set keyed by timestamp gives newest-first reads for free.
    await kvCommand(["zadd", KEY, String(Date.now()), entry]);
    return { token, persisted: true };
  }

  memory.add(entry);
  return { token, persisted: false };
}

/** Token addresses launched here, newest first. */
async function listLaunched({ limit = 50 } = {}) {
  let raw = [];
  let persisted = false;

  if (kvConfigured()) {
    try {
      const json = await kvCommand(["zrange", KEY, "0", String(limit - 1), "rev"]);
      raw = Array.isArray(json?.result) ? json.result : [];
      persisted = true;
    } catch {
      raw = [];
    }
  } else {
    raw = [...memory].reverse().slice(0, limit);
  }

  // Hidden tokens (test launches, mistakes) stay in storage but never in the
  // list — same HIDDEN_TOKENS filter the feed applies.
  const hidden = hiddenTokenSet();
  const entries = [];
  for (const item of raw) {
    try {
      const entry = typeof item === "string" ? JSON.parse(item) : item;
      if (!isHiddenToken(entry?.token, hidden)) entries.push(entry);
    } catch {
      /* skip a corrupt row rather than failing the whole list */
    }
  }

  return {
    entries,
    tokens: entries.map((e) => e.token),
    persisted,
    warning: persisted
      ? null
      : "This list is held in memory and resets when the server restarts. Set KV_REST_API_URL and KV_REST_API_TOKEN to make it durable.",
  };
}

module.exports = { recordLaunch, listLaunched, kvConfigured };
