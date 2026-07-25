"use client";

/**
 * Number formatting, in one place because these figures appear on four screens
 * and disagreeing with yourself about a price is worse than any single format.
 *
 * The problem this solves: a launch with a fixed 1,000,000,000 supply prices at
 * something like 0.0000000028 WETH. Printed raw it is unreadable, and printed
 * with `toPrecision(3)` it becomes "2.84e-9", which reads as a rounding error
 * rather than a price. Both figures — price and market cap — are therefore shown
 * in dollars wherever a rate is available, with the WETH figure kept alongside
 * because WETH is what the pool actually holds.
 */

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

function subscript(n) {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPTS[Number(d)] ?? d)
    .join("");
}

export function isNum(n) {
  return n != null && Number.isFinite(Number(n));
}

/**
 * A large figure — market cap, volume, balance. Compacted, never rounded to
 * nothing: $940 stays $940 rather than becoming $0.9K.
 */
export function fmtUsd(n, { prefix = "$" } = {}) {
  if (!isNum(n)) return "—";
  const v = Number(n);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);

  if (abs >= 1e12) return `${sign}${prefix}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${prefix}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${prefix}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${sign}${prefix}${(abs / 1e3).toFixed(1)}K`;
  if (abs >= 1) return `${sign}${prefix}${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  if (abs === 0) return `${prefix}0`;
  return `${sign}${fmtSmall(abs, prefix)}`;
}

/**
 * A price. Below 0.001 it switches to the leading-zero-count notation every DEX
 * uses — $0.0₈2845 means $0.000000002845 — because eight zeros in a row cannot
 * be counted by eye and an exponent reads like an error.
 */
export function fmtUsdPrice(n, { prefix = "$" } = {}) {
  if (!isNum(n)) return "—";
  const v = Math.abs(Number(n));
  if (v === 0) return `${prefix}0`;
  if (v >= 1000) return `${prefix}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (v >= 1) return `${prefix}${v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  if (v >= 0.001) return `${prefix}${v.toFixed(6).replace(/0+$/, "")}`;
  return fmtSmall(v, prefix);
}

/** `0.0₈2845` — the count of zeros after the point, then four significant digits. */
function fmtSmall(v, prefix) {
  const exponent = Math.floor(Math.log10(v));
  const zeros = -exponent - 1;

  // Three zeros or fewer are still countable by eye, so leave them written out.
  if (zeros <= 3) {
    return `${prefix}${v.toFixed(Math.min(18, zeros + 4)).replace(/0+$/, "")}`;
  }

  const digits = String(Math.round(v * 10 ** -exponent * 1000))
    .slice(0, 4)
    .replace(/0+$/, "");
  return `${prefix}0.0${subscript(zeros)}${digits || "1"}`;
}

/** The unabbreviated value, for a `title` so the exact figure is never lost. */
export function fullNumber(n, suffix = "") {
  if (!isNum(n)) return "unknown";
  const v = Number(n);
  const text = v < 1e-6 ? v.toExponential(6) : v.toLocaleString("en-US", { maximumFractionDigits: 18 });
  return suffix ? `${text} ${suffix}` : text;
}

/** ETH amounts. Six decimals is the most anyone reads off a screen. */
export function fmtEth(n, { symbol = "Ξ" } = {}) {
  if (!isNum(n)) return "—";
  const v = Number(n);
  if (v === 0) return `0 ${symbol}`;
  if (Math.abs(v) >= 1000) return `${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${symbol}`;
  if (Math.abs(v) >= 0.0001) return `${v.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${symbol}`;
  return `${v.toExponential(2)} ${symbol}`;
}

/** A token quantity. Millions of a memecoin do not need decimal places. */
export function fmtQty(n) {
  if (!isNum(n)) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/**
 * Price or cap in dollars when a rate exists, WETH when it does not.
 * Falling back is deliberate: a made-up dollar figure would be worse than none.
 */
export function usdOr(weth, ethUsd, formatter = fmtUsd) {
  if (!isNum(weth)) return "—";
  if (isNum(ethUsd)) return formatter(Number(weth) * Number(ethUsd));
  return fmtEth(weth);
}

export function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}
