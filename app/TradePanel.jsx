"use client";

import { useCallback, useEffect, useState } from "react";
import { shortAddress } from "./wallet";
import { XLogo } from "./constants";

/**
 * Buy and sell a launch on this site.
 *
 * Uses the pons swap router, which is a standard Uniswap V3 SwapRouter, so the
 * ABI here is the documented one, not a guess. Every transaction is signed in the
 * visitor's own wallet; nothing is custodial.
 *
 * Buying sends native ETH as msg.value and the router wraps it. Selling needs an
 * ERC-20 approval first, which is why it is two steps.
 */

const SLIPPAGE_OPTIONS = [1, 5, 15];

export default function TradePanel({ network, token: initialToken, user, onSignIn }) {
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);

  const [token, setToken] = useState(initialToken || "");
  const [side, setSide] = useState("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(5);

  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    fetch(`/api/factory?network=${encodeURIComponent(network)}`)
      .then((r) => r.json())
      .then((json) => (json.error ? setMetaError(json.error) : setMeta(json)))
      .catch(() => setMetaError("Could not load router configuration."));
  }, [network]);

  useEffect(() => {
    if (initialToken) setToken(initialToken);
  }, [initialToken]);

  /** Ask the server to quote the swap, so we can show output before signing. */
  const getQuote = useCallback(async () => {
    setQuote(null);
    setError(null);
    if (!token.trim() || !amount || Number(amount) <= 0) return;

    setQuoting(true);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), side, amount, network, slippage }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Could not quote this trade.");
      else setQuote(json);
    } catch {
      setError("Could not reach the quote endpoint.");
    } finally {
      setQuoting(false);
    }
  }, [token, amount, side, network, slippage]);

  /**
   * Execute the swap with the X wallet on the server. No browser wallet: signing
   * in with X already minted a wallet, so there is nothing to connect. The server
   * re-quotes, handles the approval for a sell, simulates, and signs.
   */
  const doTrade = useCallback(async () => {
    if (!user || !quote) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setStatus("Signing with your X wallet…");

    try {
      const res = await fetch("/api/terminal/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          side,
          amountInRaw: quote.amountInRaw,
          expectedOutRaw: quote.amountOutRaw,
          slippage,
          network,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.hint ? `${json.error} ${json.hint}` : json.error || "The trade failed.");
      } else {
        setDone({ hash: json.hash });
      }
      setStatus(null);
    } catch {
      setError("Could not reach the execute endpoint.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [user, quote, token, side, slippage, network]);

  return (
    <>
      <section className="hero hero-tight">
        <div className="eyebrow">
          <span className="live-dot" />
          Trade · pons router
        </div>
        <h1>
          Buy and sell <em>right here</em>.
          <span className="cursor" />
        </h1>
        <p>
          Swaps run through the pons router against the token's own locked WETH pool. Signed in
          your wallet, simulated first, and never custodial, this site cannot move your funds.
        </p>
      </section>

      <div className="console">
        <div className="console-bar">
          <span className="live-dot" />
          ROUTER{" "}
          {meta?.swapRouter ? (
            <>
              · <span className="bar-mono">{shortAddress(meta.swapRouter)}</span> ·{" "}
              {meta.poolFee / 10_000}% fee
            </>
          ) : (
            "· loading…"
          )}
        </div>
        <div className="console-body">
          {metaError && (
            <div className="alert alert-error">
              <span className="alert-icon">✖</span>
              <span>{metaError}</span>
            </div>
          )}

          {user ? (
            <div className="form-note wallet-row">
              <span className="live-dot" /> Trading with your X wallet · @{user.username}
            </div>
          ) : (
            <div className="wallet-cta">
              <button className="btn btn-x" onClick={onSignIn}>
                <XLogo /> Sign in with X to trade
              </button>
              <span className="form-note">
                Signing in with X gives you a wallet automatically, so there is nothing to connect.
                It signs every swap for you.
              </span>
            </div>
          )}

          <div className="side-toggle">
            {["buy", "sell"].map((s) => (
              <button
                key={s}
                className={`nav-tab ${side === s ? "nav-on" : ""}`}
                onClick={() => {
                  setSide(s);
                  setQuote(null);
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="fields">
            <label className="field">
              <span className="field-label">Token address</span>
              <input
                className="input"
                placeholder="0x… token contract address"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setQuote(null);
                }}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span className="field-label">
                Amount {side === "buy" ? "(ETH to spend)" : "(tokens to sell)"}
              </span>
              <input
                className="input"
                placeholder={side === "buy" ? "0.05" : "1000000"}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setQuote(null);
                }}
                spellCheck={false}
              />
            </label>
          </div>

          <div className="slip-row">
            <span className="field-label">Max slippage</span>
            {SLIPPAGE_OPTIONS.map((s) => (
              <button
                key={s}
                className={`btn btn-ghost ${slippage === s ? "nav-on" : ""}`}
                onClick={() => {
                  setSlippage(s);
                  // The quote carries the floor that goes on screen, so a
                  // changed tolerance invalidates it rather than silently
                  // leaving the old "minimum out" next to a new percentage.
                  setQuote(null);
                }}
              >
                {s}%
              </button>
            ))}
          </div>

          <div className="launch-foot">
            <button className="btn" onClick={getQuote} disabled={quoting || !token.trim() || !amount}>
              {quoting ? (
                <>
                  <span className="spinner" />
                  Quoting…
                </>
              ) : (
                "Get quote"
              )}
            </button>
            <button
              className="btn btn-primary"
              onClick={doTrade}
              disabled={busy || !user || !quote}
            >
              {busy ? (
                <>
                  <span className="spinner" />
                  Working…
                </>
              ) : side === "buy" ? (
                "Buy"
              ) : (
                "Sell"
              )}
            </button>
          </div>

          {quote && (
            <div className="stats" style={{ marginTop: 14 }}>
              <div className="stat">
                <div className="stat-label">You pay</div>
                <div className="stat-value">{quote.amountInLabel}</div>
              </div>
              <div className="stat">
                <div className="stat-label">You receive (est.)</div>
                <div className="stat-value">{quote.amountOutLabel}</div>
                <div className="stat-sub">before {slippage}% slippage</div>
              </div>
              <div className="stat">
                <div className="stat-label">Minimum out</div>
                <div className="stat-value stat-min">
                  {quote.minOutLabel ? quote.minOutLabel : ","}
                </div>
                <div className="stat-sub">at {slippage}% slippage</div>
              </div>
            </div>
          )}

          {status && (
            <div className="alert">
              <span className="spinner" />
              <span>{status}</span>
            </div>
          )}

          {error && (
            <div className="alert alert-error">
              <span className="alert-icon">✖</span>
              <span>{error}</span>
            </div>
          )}

          {done && (
            <div className="alert">
              <span className="alert-icon sev-good">✔</span>
              <span>
                <strong>Swap confirmed.</strong>{" "}
                {meta?.explorer && (
                  <a
                    href={`${meta.explorer}/tx/${done.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--accent)" }}
                  >
                    View transaction ↗
                  </a>
                )}
                {side === "sell" && " Proceeds arrive as WETH."}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
