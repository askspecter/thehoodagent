"use strict";

const { getAddress, isAddress } = require("ethers");

/**
 * The known-token directory: named tokens that are NOT launches here.
 *
 * The launch feed only knows tokens deployed through pons, so `buy $5 nvda`
 * cannot resolve against it — Robinhood Chain's tokenized stocks (NVDA, TSLA,
 * SPY …) are their own ERC-20s with their own pools. This module is how a plain
 * ticker reaches one of those.
 *
 * ── Why nothing is hardcoded ─────────────────────────────────────────────────
 * A wrong address here is not a bug, it is someone's money sent to the wrong
 * token, unrecoverably. So this file ships with ZERO baked-in stock addresses.
 * The directory is loaded at runtime from an authoritative source the operator
 * points it at:
 *
 *   • ROBINHOOD_TOKENLIST_URL — a Uniswap-format token list JSON. This is the
 *     canonical, curated list (Robinhood publishes one for its stock tokens);
 *     fetched server-side, filtered to the chain, and cached briefly.
 *   • ROBINHOOD_TOKENS — an inline JSON array for a handful of manual entries,
 *     same token shape. Useful for one token without standing up a whole list.
 *
 * With neither set the directory is simply empty, and a stock ticker gets an
 * honest "not configured on this deploy" rather than a guessed contract.
 *
 * Everything here is read-only and pure enough to test: parsing, filtering and
 * matching. The one impure part — the fetch — is isolated and cached.
 */

/** Standard Uniswap token-list entry, narrowed to what a trade needs. */
function normalizeEntry(raw, chainId) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.address || !isAddress(raw.address)) return null;
  // A list can span many chains; keep only this one. A missing chainId is
  // treated as "meant for us" so a hand-written ROBINHOOD_TOKENS stays simple.
  if (raw.chainId != null && Number(raw.chainId) !== Number(chainId)) return null;

  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).toLowerCase()) : [];
  const isStock =
    tags.includes("stock") ||
    tags.includes("equity") ||
    tags.includes("stock-token") ||
    /\bstock\b|\bequity\b|robinhood token/i.test(String(raw.name || ""));

  return {
    token: getAddress(raw.address),
    symbol: raw.symbol ? String(raw.symbol) : null,
    name: raw.name ? String(raw.name) : null,
    decimals: Number.isFinite(Number(raw.decimals)) ? Number(raw.decimals) : 18,
    kind: raw.kind || (isStock ? "stock" : "token"),
    logoURI: raw.logoURI || null,
    // Directory tokens carry no pool data — they price live, on demand.
    fromDirectory: true,
  };
}

/**
 * Turn either shape of source (a full token-list object or a bare array) into a
 * clean, chain-filtered, de-duplicated array. Pure — no network.
 */
function normalizeTokenList(source, chainId) {
  const rows = Array.isArray(source)
    ? source
    : Array.isArray(source?.tokens)
      ? source.tokens
      : [];

  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const entry = normalizeEntry(row, chainId);
    if (!entry) continue;
    const key = entry.token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Inline tokens from ROBINHOOD_TOKENS, if it holds valid JSON. */
function inlineTokens(chainId) {
  const raw = process.env.ROBINHOOD_TOKENS;
  if (!raw) return [];
  try {
    return normalizeTokenList(JSON.parse(raw), chainId);
  } catch {
    return [];
  }
}

// A short cache: the list changes rarely, but a cold serverless instance should
// not re-fetch it on every keystroke either. Keyed by chain so two chains do
// not share one list.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // chainId -> { at, tokens, source, warning }

/**
 * Load the directory for a chain: inline tokens always, plus the remote list if
 * a URL is configured. Never throws — a directory that cannot load is an empty
 * directory, not a broken terminal.
 *
 * @returns {Promise<{tokens: Array, source: string, warning: string|null}>}
 */
async function loadDirectory(chainId, { force = false } = {}) {
  const key = String(chainId);
  const now = Date.now();
  const cached = cache.get(key);
  if (!force && cached && now - cached.at < CACHE_TTL_MS) return cached;

  const inline = inlineTokens(chainId);
  const url = process.env.ROBINHOOD_TOKENLIST_URL;

  let remote = [];
  let warning = null;
  let source = inline.length ? "inline" : "empty";

  if (url) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        // 6s is plenty for a JSON list; a stuck fetch must not hang a command.
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      remote = normalizeTokenList(await res.json(), chainId);
      source = inline.length ? "url+inline" : "url";
    } catch (error) {
      warning = `The token list at ROBINHOOD_TOKENLIST_URL could not be read (${error.message}).`;
      // Fall back to whatever inline tokens exist. Better a small directory than
      // none, and the warning says why it is small.
    }
  } else if (!inline.length) {
    warning =
      "No stock/token directory is configured. Set ROBINHOOD_TOKENLIST_URL to the official token list so tickers like NVDA resolve to their real contracts.";
  }

  // Inline wins on a symbol/address clash: it is the operator's explicit override.
  const byAddr = new Map();
  for (const t of [...remote, ...inline]) byAddr.set(t.token.toLowerCase(), t);
  const tokens = [...byAddr.values()];

  const value = { at: now, tokens, source, warning };
  cache.set(key, value);
  return value;
}

/** Is a query a plausible ticker (not an address, not a sentence)? */
function looksLikeTicker(query) {
  return /^[a-z0-9.]{1,10}$/i.test(String(query || "").replace(/^\$/, "").trim());
}

module.exports = {
  loadDirectory,
  normalizeTokenList,
  normalizeEntry,
  looksLikeTicker,
};
