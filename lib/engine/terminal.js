"use strict";

const { getAddress, isAddress } = require("ethers");

/**
 * The trading terminal's command language.
 *
 * The whole point is that "buy me $5 nvda" is a complete instruction. Nobody
 * types a contract address, picks a fee tier, or converts dollars to ETH in
 * their head first — the terminal does that, shows what it worked out, and only
 * then asks for a signature.
 *
 * This module is deliberately pure: parsing and token resolution, no network, no
 * keys, no side effects. That is what makes the grammar testable, and a trading
 * grammar that is not tested is a way to spend the wrong amount of money.
 *
 * ── The one ambiguity, resolved on purpose ──────────────────────────────────
 * `buy 5 nvda` has to mean something. It means five DOLLARS, because that is how
 * people say it out loud and because the alternative — five ETH — is off by four
 * orders of magnitude in the expensive direction. ETH is never assumed; it has
 * to be said: `buy 0.01 eth nvda`. Selling is the mirror image: a bare number is
 * a quantity of tokens, because "sell 1000" plainly means a thousand tokens.
 */

/** Every verb the terminal answers to, mapped to its canonical name. */
const VERBS = {
  buy: "buy",
  b: "buy",
  ape: "buy",
  long: "buy",
  sell: "sell",
  s: "sell",
  dump: "sell",
  exit: "sell",
  price: "price",
  p: "price",
  quote: "price",
  chart: "price",
  audit: "audit",
  scan: "audit",
  check: "audit",
  create: "create",
  launch: "create",
  deploy: "create",
  mint: "create",
  balance: "balance",
  bal: "balance",
  wallet: "balance",
  portfolio: "portfolio",
  folio: "portfolio",
  pos: "portfolio",
  holdings: "portfolio",
  bags: "portfolio",
  list: "list",
  ls: "list",
  top: "list",
  launches: "list",
  feed: "list",
  trending: "list",
  fund: "fund",
  deposit: "fund",
  receive: "fund",
  topup: "fund",
  send: "send",
  transfer: "send",
  withdraw: "send",
  convert: "convert",
  conv: "convert",
  gas: "gas",
  network: "gas",
  status: "gas",
  help: "help",
  "?": "help",
  commands: "help",
  clear: "clear",
  cls: "clear",
  login: "login",
  signin: "login",
  connect: "connect",
};

/** Filler words a person types that carry no meaning for the parser. */
const NOISE = new Set(["me", "of", "for", "worth", "in", "the", "a", "some", "please", "pls"]);

/**
 * Pull an amount out of a token list.
 *
 * Recognised: `$5`, `5$`, `5usd`, `5 dollars`, `0.01eth`, `0.5 ether`, `50%`,
 * `all`, `half`, `max`, and a bare number whose unit the caller decides.
 *
 * @returns {{amount: object, rest: string[]}|null}
 */
function takeAmount(words) {
  const rest = [...words];

  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i].toLowerCase();

    if (word === "all" || word === "max" || word === "everything") {
      rest.splice(i, 1);
      return { amount: { unit: "percent", value: 100 }, rest };
    }
    if (word === "half") {
      rest.splice(i, 1);
      return { amount: { unit: "percent", value: 50 }, rest };
    }

    // "$5" / "5$" / "5usd" / "0.01eth" / "50%" — value and unit fused.
    const fused = word.match(/^\$?(\d+(?:[.,]\d+)?)(\$|%|usdc|usd|dollars?|ether|eth|e)?$/);
    if (fused) {
      const value = Number(fused[1].replace(",", "."));
      if (!Number.isFinite(value)) continue;

      const suffix = fused[2];
      const dollarPrefixed = word.startsWith("$");
      let unit = null;

      if (suffix === "%") unit = "percent";
      else if (suffix === "$" || /^usdc?$|^dollars?$/.test(suffix || "")) unit = "usd";
      else if (/^(eth|ether|e)$/.test(suffix || "")) unit = "eth";
      else if (dollarPrefixed) unit = "usd";

      // A unit can also follow as its own word: "5 usd", "0.01 eth".
      if (!unit && rest[i + 1]) {
        const next = rest[i + 1].toLowerCase();
        if (/^(usd|usdc|dollars?|bucks?)$/.test(next)) {
          unit = "usd";
          rest.splice(i + 1, 1);
        } else if (/^(eth|ether|weth)$/.test(next)) {
          unit = "eth";
          rest.splice(i + 1, 1);
        } else if (next === "%" || next === "percent") {
          unit = "percent";
          rest.splice(i + 1, 1);
        }
      }

      rest.splice(i, 1);
      return { amount: { unit: unit || "bare", value }, rest };
    }
  }

  return null;
}

/**
 * Parse a `send` line into a transfer intent.
 *
 * `send 0.05 eth to 0x…` moves native ETH; `send 100 pons to 0x…`, `send all
 * pons to 0x…` and `send 50% pons to 0x…` move an ERC-20. The recipient must be
 * a 0x address — no handle resolution, because a transfer cannot be undone and a
 * mistyped handle must never resolve to some stranger's wallet.
 */
function parseSend(args, raw) {
  const lower = args.map((w) => w.toLowerCase());

  // The recipient is whatever follows `to`, or a trailing bare address.
  let recipient = null;
  let before = args;
  const toIdx = lower.lastIndexOf("to");
  if (toIdx !== -1) {
    recipient = args[toIdx + 1] || null;
    before = args.slice(0, toIdx);
  } else if (args.length && isAddress(args[args.length - 1])) {
    recipient = args[args.length - 1];
    before = args.slice(0, -1);
  }

  if (!recipient || !isAddress(recipient)) {
    return {
      kind: "error",
      raw,
      message: "Send to which address? End with a 0x… address: `send 0.05 eth to 0xabc…`.",
    };
  }
  const to = getAddress(recipient);

  const taken = takeAmount(before);
  if (!taken) {
    return {
      kind: "error",
      raw,
      message: "How much? `send 0.05 eth to …`, `send 100 pons to …`, or `send all pons to …`.",
    };
  }
  if (taken.amount.value <= 0) {
    return { kind: "error", raw, message: "Amount has to be greater than zero." };
  }

  const asset = taken.rest.join(" ").replace(/^\$/, "").trim();
  const assetLower = asset.toLowerCase();
  const { unit, value } = taken.amount;

  // Native ETH: no asset named, or the asset is spelled "eth".
  if (!asset || assetLower === "eth" || assetLower === "ether") {
    if (unit === "usd" || unit === "percent") {
      return {
        kind: "error",
        raw,
        message: "Send ETH as an ETH amount: `send 0.05 eth to …`.",
      };
    }
    return { kind: "send", asset: "native", to, amount: { unit: "eth", value }, raw };
  }

  // An ERC-20. A quantity or a percentage of the holding, never ETH or dollars.
  if (unit === "eth" || unit === "usd") {
    return {
      kind: "error",
      raw,
      message: `Send a token by quantity or percentage: \`send 100 ${asset} to …\` or \`send all ${asset} to …\`.`,
    };
  }
  if (unit === "percent" && value > 100) {
    return { kind: "error", raw, message: "You cannot send more than 100% of a holding." };
  }
  return {
    kind: "send",
    asset: "token",
    query: asset,
    to,
    amount: { unit: unit === "bare" ? "token" : unit, value },
    raw,
  };
}

/**
 * Parse one line into an intent.
 *
 * Always returns an object with a `kind`. An unparseable line is `{kind:"unknown"}`
 * carrying the input back, never an exception — the terminal answers everything.
 */
function parseCommand(input) {
  const raw = String(input || "").trim();
  if (!raw) return { kind: "empty" };

  const words = raw.split(/\s+/);
  const verbWord = words[0].toLowerCase().replace(/[:,]$/, "");
  const verb = VERBS[verbWord];

  // A bare address or $ticker is a price lookup — the most common thing anyone
  // pastes into a box like this, and making them type `price` first is friction.
  if (!verb) {
    if (words.length === 1 && (isAddress(raw) || /^\$[a-z0-9_]{1,15}$/i.test(raw))) {
      return { kind: "price", query: raw.replace(/^\$/, ""), raw };
    }
    return { kind: "unknown", raw };
  }

  const args = words.slice(1).filter((w) => !NOISE.has(w.toLowerCase()));

  switch (verb) {
    case "buy":
    case "sell": {
      const taken = takeAmount(args);
      const query = (taken ? taken.rest : args).join(" ").replace(/^\$/, "").trim();

      if (!query) {
        return {
          kind: "error",
          raw,
          message: `${verb === "buy" ? "Buy" : "Sell"} what? Try \`${
            verb === "buy" ? "buy $5 sonic" : "sell all sonic"
          }\`.`,
        };
      }
      if (!taken) {
        return {
          kind: "error",
          raw,
          message:
            verb === "buy"
              ? `How much? \`buy $5 ${query}\` for five dollars, \`buy 0.01 eth ${query}\` to name the ETH.`
              : `How much? \`sell all ${query}\`, \`sell 50% ${query}\`, or \`sell 1000 ${query}\`.`,
        };
      }

      // The documented default, and the reason it is written down twice.
      const unit =
        taken.amount.unit !== "bare"
          ? taken.amount.unit
          : verb === "buy"
            ? "usd"
            : "token";

      if (taken.amount.value <= 0) {
        return { kind: "error", raw, message: "Amount has to be greater than zero." };
      }
      if (unit === "percent" && taken.amount.value > 100) {
        return { kind: "error", raw, message: "You cannot sell more than 100% of a holding." };
      }
      if (verb === "buy" && unit === "percent") {
        return {
          kind: "error",
          raw,
          message: "A percentage only makes sense when selling. Say `buy $5` or `buy 0.01 eth`.",
        };
      }

      return {
        kind: verb,
        query,
        amount: { unit, value: taken.amount.value },
        raw,
      };
    }

    case "price":
    case "audit": {
      const query = args.join(" ").replace(/^\$/, "").trim();
      if (!query) {
        return {
          kind: "error",
          raw,
          message: `Which token? Try \`${verb} sonic\` or paste a contract address.`,
        };
      }
      return { kind: verb, query, raw };
    }

    case "create": {
      // `create` alone opens the form. `create HOOD Hood Rat` prefills it: the
      // first word is the ticker because a ticker is one word and a name is not.
      const [symbol, ...nameParts] = args;
      return {
        kind: "create",
        symbol: symbol ? symbol.replace(/^\$/, "").toUpperCase() : null,
        name: nameParts.length ? nameParts.join(" ") : null,
        raw,
      };
    }

    case "send":
      return parseSend(args, raw);

    case "convert": {
      // "convert $100 to eth", "convert 0.5 eth", "convert 0.5 eth to usd".
      let target = null;
      const toIdx = args.map((w) => w.toLowerCase()).lastIndexOf("to");
      let amountWords = args;
      if (toIdx !== -1 && args[toIdx + 1]) {
        const t = args[toIdx + 1].toLowerCase();
        if (/^(eth|ether|weth)$/.test(t)) target = "eth";
        else if (/^(usd|usdc|dollars?|bucks?)$/.test(t)) target = "usd";
        amountWords = args.slice(0, toIdx);
      }
      const taken = takeAmount(amountWords);
      if (!taken) {
        return {
          kind: "error",
          raw,
          message: "Convert what? Try `convert $100 to eth` or `convert 0.5 eth`.",
        };
      }
      if (taken.amount.unit === "percent") {
        return { kind: "error", raw, message: "A percentage has nothing to convert against." };
      }
      return { kind: "convert", amount: taken.amount, target, raw };
    }

    default:
      return { kind: verb, raw };
  }
}

/** Normalise a symbol for comparison: `$PONS` and `pons` are the same thing. */
function normaliseSymbol(value) {
  return String(value || "")
    .replace(/^\$/, "")
    .trim()
    .toLowerCase();
}

/**
 * Turn what someone typed into a contract address.
 *
 * Order matters: an address is taken literally, then an exact ticker, then an
 * exact name, then a prefix. A fuzzy match is never returned silently — when
 * more than one launch answers to a ticker the caller gets every candidate back
 * and has to disambiguate, because buying the wrong token is unrecoverable.
 *
 * @param {string} query
 * @param {Array<{token: string, symbol?: string, name?: string, marketCapWeth?: number}>} launches
 * @returns {{ok: true, token: string, launch: object|null, matchedBy: string}
 *          |{ok: false, reason: "not_found"|"ambiguous", candidates?: Array}}
 */
function resolveToken(query, launches = []) {
  const text = String(query || "").trim();
  if (!text) return { ok: false, reason: "not_found" };

  if (isAddress(text)) {
    const token = getAddress(text);
    const known = launches.find((l) => l.token && getAddress(l.token) === token) || null;
    return { ok: true, token, launch: known, matchedBy: "address" };
  }

  const needle = normaliseSymbol(text);

  const bySymbol = launches.filter((l) => normaliseSymbol(l.symbol) === needle);
  const byName = launches.filter((l) => String(l.name || "").trim().toLowerCase() === needle);
  const byPrefix = launches.filter(
    (l) =>
      normaliseSymbol(l.symbol).startsWith(needle) ||
      String(l.name || "").toLowerCase().startsWith(needle)
  );

  for (const [matchedBy, matches] of [
    ["symbol", bySymbol],
    ["name", byName],
    ["prefix", byPrefix],
  ]) {
    if (matches.length === 1) {
      return { ok: true, token: getAddress(matches[0].token), launch: matches[0], matchedBy };
    }
    if (matches.length > 1) {
      // Deepest liquidity first: if a ticker is squatted, the real one is
      // usually the one with a market, and the operator still has to choose.
      const candidates = [...matches].sort(
        (a, b) => (b.marketCapWeth || 0) - (a.marketCapWeth || 0)
      );
      return { ok: false, reason: "ambiguous", candidates };
    }
  }

  return { ok: false, reason: "not_found" };
}

/** The `help` output, kept next to the grammar it documents so it cannot drift. */
const HELP = [
  ["buy $5 sonic", "Buy five dollars of the token. Bare numbers are dollars."],
  ["buy 0.01 eth sonic", "Name the unit to spend ETH instead."],
  ["buy $5 nvda", "Trade a stock token by ticker, once the directory is set."],
  ["sell all sonic", "Sell the whole position. `sell 50% sonic` and `sell 1000 sonic` work too."],
  ["price sonic", "Live pool price, market cap and graduation progress."],
  ["audit 0x…", "Full honeypot and owner-power scan."],
  ["fund", "Show your wallet address to top it up with ETH."],
  ["send 0.05 eth to 0x…", "Move ETH out. `send 100 sonic to 0x…` moves a token."],
  ["convert $100 to eth", "Quick price math at the live rate."],
  ["gas", "Current gas price and chain status."],
  ["create SONIC Sonic Coin", "Open the create form, ticker and name filled in."],
  ["balance", "Your wallet and what is in it."],
  ["portfolio", "Every launch you hold, priced."],
  ["list", "The launch feed, biggest first."],
  ["clear", "Wipe the screen."],
];

module.exports = {
  parseCommand,
  parseSend,
  resolveToken,
  takeAmount,
  normaliseSymbol,
  VERBS,
  HELP,
};
