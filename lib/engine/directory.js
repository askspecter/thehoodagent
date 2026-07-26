"use strict";

const { getAddress, isAddress } = require("ethers");

/**
 * The known-token directory: named tokens that are NOT launches here.
 *
 * The launch feed only knows tokens deployed through pons, so `buy $5 nvda`
 * cannot resolve against it — Robinhood Chain's tokenized stocks (NVDA, TSLA,
 * SPY …) are their own ERC-20s with their own contracts. This module is how a
 * plain ticker reaches one of those.
 *
 * ── Where the addresses come from (never invented) ───────────────────────────
 * A wrong address here is not a bug, it is someone's money sent to the wrong
 * token, unrecoverably. So this file hardcodes ZERO stock addresses. It resolves
 * tickers from authoritative sources, in this order of trust:
 *
 *   1. Robinhood's own Stock Token API — GET https://api.robinhood.com/rhj/assets
 *      returns every stock token with its per-chain `deployments` (contract
 *      address + chainId) and a live bid/ask. This is the canonical map from
 *      NVDA → its real contract on chain 4663, straight from the issuer.
 *      Overridable with ROBINHOOD_ASSETS_URL; set it to "" to disable.
 *   2. ROBINHOOD_TOKENLIST_URL — a Uniswap-format token list JSON, for any other
 *      listed token that is not a Robinhood stock.
 *   3. ROBINHOOD_TOKENS — an inline JSON array for one-off manual entries. Wins
 *      on a clash, because it is the operator's explicit override.
 *
 * The impure part — the fetches — is isolated and cached; the parsing is pure and
 * tested.
 */

const DEFAULT_ASSETS_URL = "https://api.robinhood.com/rhj/assets";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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
 * Turn either shape of token-list source (a full list object or a bare array)
 * into clean, chain-filtered, de-duplicated entries. Pure — no network.
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

/**
 * Turn a Robinhood Stock Token API `/assets` response into directory entries.
 *
 * Each asset lists `deployments` across chains; we take the one whose chainId is
 * ours and carry the live bid/ask through so a stock can be priced from the
 * issuer even when no on-chain pool exists to quote against. Pure — no network.
 */
function normalizeAssets(source, chainId) {
  const rows = Array.isArray(source)
    ? source
    : source?.assets || source?.results || source?.data || source?.items || [];
  if (!Array.isArray(rows)) return [];

  const seen = new Set();
  const out = [];
  for (const asset of rows) {
    if (!asset || typeof asset !== "object") continue;
    const symbol = asset.tokenSymbol || asset.symbol || asset.ticker;
    const deployments = Array.isArray(asset.deployments) ? asset.deployments : [];
    const here = deployments.find((d) => d && Number(d.chainId) === Number(chainId));
    const address = here?.contractAddress || here?.address;
    if (!symbol || !address || !isAddress(address)) continue;

    const token = getAddress(address);
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const bid = num(asset.bid);
    const ask = num(asset.ask);
    out.push({
      token,
      symbol: String(symbol),
      name: asset.name ? String(asset.name) : `${symbol} · stock token`,
      decimals: Number.isFinite(Number(here?.decimals)) ? Number(here.decimals) : 18,
      kind: "stock",
      bid,
      ask,
      // The mid of the issuer's own quote, in its quote currency — an
      // authoritative USD price that needs no pool to exist.
      priceUsd: bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask,
      currency: asset.currency || "USD",
      tradingHalted: Boolean(asset.isTradingHalt),
      logoURI: asset.logoURI || asset.iconUrl || null,
      fromDirectory: true,
    });
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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // Enough for a JSON list; a stuck fetch must never hang a command.
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// A short cache: the list changes rarely, but a cold serverless instance should
// not re-fetch it on every keystroke either. Keyed by chain so two chains do
// not share one list.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // chainId -> { at, tokens, source, warning }

/**
 * Load the directory for a chain: the Robinhood stock-token API, plus any
 * configured token list, plus inline tokens. Never throws — a directory that
 * cannot load is an empty directory, not a broken terminal.
 *
 * @returns {Promise<{tokens: Array, source: string, warning: string|null}>}
 */
async function loadDirectory(chainId, { force = false } = {}) {
  const key = String(chainId);
  const now = Date.now();
  const cached = cache.get(key);
  if (!force && cached && now - cached.at < CACHE_TTL_MS) return cached;

  const sources = [];
  const warnings = [];

  // 1. Robinhood stock tokens (default on; set ROBINHOOD_ASSETS_URL="" to skip).
  const assetsUrl =
    process.env.ROBINHOOD_ASSETS_URL != null ? process.env.ROBINHOOD_ASSETS_URL : DEFAULT_ASSETS_URL;
  if (assetsUrl) {
    try {
      const stocks = normalizeAssets(await fetchJson(assetsUrl), chainId);
      if (stocks.length) sources.push({ name: "robinhood-assets", tokens: stocks });
      else warnings.push("The Robinhood stock-token API returned no tokens for this chain.");
    } catch (error) {
      warnings.push(`The Robinhood stock-token API could not be read (${error.message}).`);
    }
  }

  // 2. An optional extra token list (non-stock listed tokens).
  const listUrl = process.env.ROBINHOOD_TOKENLIST_URL;
  if (listUrl) {
    try {
      sources.push({
        name: "tokenlist",
        tokens: normalizeTokenList(await fetchJson(listUrl), chainId),
      });
    } catch (error) {
      warnings.push(`ROBINHOOD_TOKENLIST_URL could not be read (${error.message}).`);
    }
  }

  // 3. Inline overrides, applied last so they win any clash.
  const inline = inlineTokens(chainId);
  if (inline.length) sources.push({ name: "inline", tokens: inline });

  // Merge by address; a later source overrides an earlier one.
  const byAddr = new Map();
  for (const src of sources) {
    for (const t of src.tokens) byAddr.set(t.token.toLowerCase(), t);
  }
  const tokens = [...byAddr.values()];

  const value = {
    at: now,
    tokens,
    source: sources.map((s) => s.name).join("+") || "empty",
    warning: tokens.length ? null : warnings[0] || "No token directory configured.",
  };
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
  normalizeAssets,
  normalizeEntry,
  looksLikeTicker,
};
