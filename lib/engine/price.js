"use strict";

/**
 * ETH → USD, so prices and market caps can be read by a human.
 *
 * Everything else in this engine is denominated in WETH because that is what the
 * pool actually holds. That is correct and it is also unreadable: a launch prices
 * at 0.0000000028 WETH and caps at 2.8 WETH, and nobody can tell whether that is
 * big or small at a glance. One conversion fixes both figures.
 *
 * Rules this follows, because a wrong USD figure is worse than none:
 *
 *  • The rate is fetched, never guessed. If every source fails we return null and
 *    the UI falls back to WETH rather than inventing a number.
 *  • `ETH_USD_PRICE` overrides everything, for offline development and for tests
 *    that must not touch the network.
 *  • The last good rate is kept and served as `stale: true` if a later refresh
 *    fails, so one flaky request does not blank the whole feed.
 */

const CACHE_TTL_MS = 60_000;
/** How long a stale rate may still be served after refreshes start failing. */
const STALE_MAX_MS = 30 * 60_000;
const TIMEOUT_MS = 4_000;

/** Two independent sources: neither is trusted enough to be the only one. */
const SOURCES = [
  {
    name: "coinbase",
    url: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
    read: (json) => Number(json?.data?.amount),
  },
  {
    name: "coingecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    read: (json) => Number(json?.ethereum?.usd),
  },
];

let cached = null; // { usd, source, at }
let inflight = null;

/** A price that is not a positive, finite, plausible dollar figure is a bug. */
function plausible(value) {
  return Number.isFinite(value) && value > 0 && value < 1_000_000;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRate() {
  for (const source of SOURCES) {
    try {
      const usd = source.read(await fetchJson(source.url));
      if (plausible(usd)) return { usd, source: source.name, at: Date.now() };
    } catch {
      /* try the next source — one provider being down is not an outage */
    }
  }
  return null;
}

/**
 * The current ETH price in USD.
 *
 * @returns {Promise<{usd: number, source: string, at: number, stale: boolean}|null>}
 *          null when no source could be reached and nothing usable is cached.
 */
async function getEthUsd() {
  const override = Number(process.env.ETH_USD_PRICE);
  if (plausible(override)) {
    return { usd: override, source: "ETH_USD_PRICE", at: Date.now(), stale: false };
  }

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached, stale: false };
  }

  // Collapse concurrent refreshes: a page load hits several routes at once and
  // they should share one upstream request, not race each other.
  inflight = inflight || fetchRate().finally(() => (inflight = null));
  const fresh = await inflight;

  if (fresh) {
    cached = fresh;
    return { ...fresh, stale: false };
  }

  if (cached && Date.now() - cached.at < STALE_MAX_MS) {
    return { ...cached, stale: true };
  }
  return null;
}

/** Convert a USD amount to ETH at the given rate. Returns null if impossible. */
function usdToEth(usd, ethUsd) {
  const amount = Number(usd);
  const rate = Number(ethUsd);
  if (!Number.isFinite(amount) || amount <= 0 || !plausible(rate)) return null;
  return amount / rate;
}

/** Test seam: drop the cache so a test never inherits another test's rate. */
function resetEthUsdCache() {
  cached = null;
  inflight = null;
}

module.exports = { getEthUsd, usdToEth, resetEthUsdCache };
