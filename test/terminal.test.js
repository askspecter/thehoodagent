"use strict";

const { expect } = require("chai");
const { parseCommand, resolveToken, normaliseSymbol } = require("../lib/engine/terminal");
const { priceFromSqrt } = require("../lib/engine/pons");
const { usdToEth } = require("../lib/engine/price");
const { resolveAmountIn } = require("../lib/engine/trade");

/**
 * The terminal grammar decides how much money moves, so it is pinned here.
 * "buy me $5 nvda" meaning five ETH instead of five dollars is a four-orders-of-
 * magnitude bug that no amount of UI polish would catch.
 */
describe("terminal grammar", function () {
  describe("buying", function () {
    it("reads the shape the product was asked for", function () {
      const out = parseCommand("buy me 5$ nvda");
      expect(out.kind).to.equal("buy");
      expect(out.query).to.equal("nvda");
      expect(out.amount).to.deep.equal({ unit: "usd", value: 5 });
    });

    it("accepts a leading dollar sign", function () {
      expect(parseCommand("buy $5 pons").amount).to.deep.equal({ unit: "usd", value: 5 });
      expect(parseCommand("buy $0.50 pons").amount).to.deep.equal({ unit: "usd", value: 0.5 });
    });

    it("treats a bare number as dollars, never as ETH", function () {
      // The expensive direction of this ambiguity is ETH, so it is never assumed.
      expect(parseCommand("buy 5 pons").amount).to.deep.equal({ unit: "usd", value: 5 });
    });

    it("spends ETH only when ETH is actually named", function () {
      expect(parseCommand("buy 0.01 eth pons").amount).to.deep.equal({ unit: "eth", value: 0.01 });
      expect(parseCommand("buy 0.01eth pons").amount).to.deep.equal({ unit: "eth", value: 0.01 });
    });

    it("strips filler words and the ticker's dollar sign", function () {
      const out = parseCommand("buy me $5 worth of $PONS");
      expect(out.query).to.equal("PONS");
      expect(out.amount.value).to.equal(5);
    });

    it("refuses a percentage, which cannot mean anything on a buy", function () {
      expect(parseCommand("buy 50% pons").kind).to.equal("error");
    });

    it("asks rather than guesses when the amount is missing", function () {
      const out = parseCommand("buy pons");
      expect(out.kind).to.equal("error");
      expect(out.message).to.match(/how much/i);
    });

    it("rejects zero and negative sizes", function () {
      expect(parseCommand("buy $0 pons").kind).to.equal("error");
    });
  });

  describe("selling", function () {
    it("reads `all` as the whole position", function () {
      const out = parseCommand("sell all pons");
      expect(out.kind).to.equal("sell");
      expect(out.amount).to.deep.equal({ unit: "percent", value: 100 });
    });

    it("reads a percentage", function () {
      expect(parseCommand("sell 50% pons").amount).to.deep.equal({ unit: "percent", value: 50 });
      expect(parseCommand("sell half pons").amount).to.deep.equal({ unit: "percent", value: 50 });
    });

    it("treats a bare number as a token quantity, the mirror of buying", function () {
      expect(parseCommand("sell 1000 pons").amount).to.deep.equal({ unit: "token", value: 1000 });
    });

    it("refuses more than the whole position", function () {
      expect(parseCommand("sell 150% pons").kind).to.equal("error");
    });
  });

  describe("everything else", function () {
    it("maps aliases onto one canonical verb", function () {
      expect(parseCommand("p pons").kind).to.equal("price");
      expect(parseCommand("scan pons").kind).to.equal("audit");
      expect(parseCommand("launch HOOD").kind).to.equal("create");
      expect(parseCommand("bags").kind).to.equal("portfolio");
    });

    it("treats a bare address as a price lookup", function () {
      const out = parseCommand("0x39dBED3a2bd333467115dE45665cC57F813C4571");
      expect(out.kind).to.equal("price");
      expect(out.query).to.equal("0x39dBED3a2bd333467115dE45665cC57F813C4571");
    });

    it("treats a bare $ticker as a price lookup", function () {
      expect(parseCommand("$pons")).to.include({ kind: "price", query: "pons" });
    });

    it("splits `create` into a ticker and a name", function () {
      const out = parseCommand("create hood Hood Rat");
      expect(out).to.include({ kind: "create", symbol: "HOOD", name: "Hood Rat" });
    });

    it("answers an unknown line instead of throwing", function () {
      expect(parseCommand("wen moon").kind).to.equal("unknown");
      expect(parseCommand("   ").kind).to.equal("empty");
      expect(parseCommand(undefined).kind).to.equal("empty");
    });
  });
});

describe("ticker resolution", function () {
  const launches = [
    { token: "0x39dBED3a2bd333467115dE45665cC57F813C4571", symbol: "PONS", name: "Pons", marketCapWeth: 12 },
    { token: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "HOOD", name: "Hood Rat", marketCapWeth: 3 },
    { token: "0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA", symbol: "HOOD", name: "Hood Two", marketCapWeth: 90 },
  ];

  it("takes an address literally and checksums it", function () {
    const out = resolveToken("0x39dbed3a2bd333467115de45665cc57f813c4571", launches);
    expect(out.ok).to.equal(true);
    expect(out.token).to.equal("0x39dBED3a2bd333467115dE45665cC57F813C4571");
    expect(out.matchedBy).to.equal("address");
  });

  it("resolves a unique ticker, with or without the dollar sign", function () {
    expect(resolveToken("pons", launches).token).to.equal(launches[0].token);
    expect(resolveToken("$PONS", launches).token).to.equal(launches[0].token);
  });

  it("refuses to pick between duplicate tickers", function () {
    // Ticker squatting is normal on a permissionless launchpad, and guessing
    // here would mean buying the wrong token with no way back.
    const out = resolveToken("hood", launches);
    expect(out.ok).to.equal(false);
    expect(out.reason).to.equal("ambiguous");
    expect(out.candidates).to.have.length(2);
    // Deepest market first, so the operator sees the likely one at the top.
    expect(out.candidates[0].name).to.equal("Hood Two");
  });

  it("reports a miss rather than inventing a match", function () {
    expect(resolveToken("nvda", launches)).to.deep.include({ ok: false, reason: "not_found" });
  });

  it("normalises symbols consistently", function () {
    expect(normaliseSymbol("$PoNs ")).to.equal("pons");
  });
});

describe("pool pricing with decimals", function () {
  const Q96 = 2 ** 96;

  it("leaves an 18/18 pair unscaled, as before", function () {
    expect(priceFromSqrt(BigInt(Q96), true, 18, 18)).to.be.closeTo(1, 1e-9);
  });

  it("scales when the token does not use 18 decimals", function () {
    // A 6-decimal token in a 1:1 raw-unit pool is worth 1e-12 WETH per whole
    // token. Assuming 18 decimals reported it as 1 — off by twelve orders.
    expect(priceFromSqrt(BigInt(Q96), true, 6, 18)).to.be.closeTo(1e-12, 1e-18);
    expect(priceFromSqrt(BigInt(Q96), false, 6, 18)).to.be.closeTo(1e-12, 1e-18);
  });

  it("keeps precision on the very small prices a 1e9 launch trades at", function () {
    // sqrtPriceX96 for a price of 4e-18 raw. Squaring in BigInt rather than in
    // a double is what keeps this from drifting in the fourth digit.
    const sqrt = BigInt(Math.floor(2e-9 * Q96));
    const price = priceFromSqrt(sqrt, true, 18, 18);
    expect(price).to.be.closeTo(4e-18, 4e-22);
  });

  it("returns null instead of Infinity or NaN", function () {
    expect(priceFromSqrt(0n, true)).to.equal(null);
    expect(priceFromSqrt(0n, false)).to.equal(null);
    expect(priceFromSqrt(null, true)).to.equal(null);
  });
});

describe("dollar conversion", function () {
  it("converts at the given rate", function () {
    expect(usdToEth(5, 2500)).to.equal(0.002);
  });

  it("refuses a missing or absurd rate rather than returning a wrong size", function () {
    expect(usdToEth(5, null)).to.equal(null);
    expect(usdToEth(5, 0)).to.equal(null);
    expect(usdToEth(0, 2500)).to.equal(null);
  });
});

/**
 * The step between "five dollars" and a uint256. Everything the parser gets
 * right is undone if this converts wrongly, so the wei figures are pinned.
 */
describe("sizing a trade", function () {
  const token = "0x39dBED3a2bd333467115dE45665cC57F813C4571";

  it("converts dollars to wei at the given rate", async function () {
    const out = await resolveAmountIn(null, {
      side: "buy",
      amount: { unit: "usd", value: 5 },
      token,
      decimals: 18,
      ethUsd: 2500,
    });
    expect(out.ok).to.equal(true);
    // $5 at $2,500/ETH is 0.002 ETH.
    expect(out.amountIn).to.equal(2_000_000_000_000_000n);
    expect(out.basis).to.match(/\$5 at \$2,500\/ETH/);
  });

  it("refuses a dollar amount when no rate exists, instead of guessing one", async function () {
    const out = await resolveAmountIn(null, {
      side: "buy",
      amount: { unit: "usd", value: 5 },
      token,
      decimals: 18,
      ethUsd: null,
    });
    expect(out.ok).to.equal(false);
    expect(out.error).to.match(/dollar amount cannot be converted/i);
  });

  it("takes an ETH amount literally", async function () {
    const out = await resolveAmountIn(null, {
      side: "buy",
      amount: { unit: "eth", value: 0.01 },
      token,
      decimals: 18,
      ethUsd: 2500,
    });
    expect(out.amountIn).to.equal(10_000_000_000_000_000n);
  });

  it("scales a sell quantity by the token's own decimals", async function () {
    const eighteen = await resolveAmountIn(null, {
      side: "sell",
      amount: { unit: "token", value: 1000 },
      token,
      decimals: 18,
    });
    expect(eighteen.amountIn).to.equal(1000n * 10n ** 18n);

    const six = await resolveAmountIn(null, {
      side: "sell",
      amount: { unit: "token", value: 1000 },
      token,
      decimals: 6,
    });
    expect(six.amountIn).to.equal(1000n * 10n ** 6n);
  });

  it("will not size a percentage without a wallet to read", async function () {
    const out = await resolveAmountIn(null, {
      side: "sell",
      amount: { unit: "percent", value: 50 },
      token,
      decimals: 18,
      owner: null,
    });
    expect(out.ok).to.equal(false);
    expect(out.error).to.match(/connect a wallet|sign in/i);
  });
});
