"use client";

import { useCallback, useEffect, useState } from "react";
import { Interface, formatEther, parseEther, parseUnits, formatUnits } from "ethers";
import {
  connect,
  currentAccount,
  hasWallet,
  humanError,
  sendTransaction,
  shortAddress,
  simulate,
  waitForReceipt,
} from "./wallet";

/**
 * Buy and sell a launch on this site.
 *
 * Uses the pons swap router, which is a standard Uniswap V3 SwapRouter — so the
 * ABI here is the documented one, not a guess. Every transaction is signed in the
 * visitor's own wallet; nothing is custodial.
 *
 * Buying sends native ETH as msg.value and the router wraps it. Selling needs an
 * ERC-20 approval first, which is why it is two steps.
 */

const ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
];

const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];

const routerIface = new Interface(ROUTER_ABI);
const erc20Iface = new Interface(ERC20_ABI);

const SLIPPAGE_OPTIONS = [1, 5, 15];

export default function TradePanel({ network, token: initialToken }) {
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);

  const [account, setAccount] = useState(null);
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
    currentAccount().then(setAccount);
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

  const doConnect = useCallback(async () => {
    setError(null);
    try {
      setAccount(await connect());
    } catch (err) {
      setError(humanError(err));
    }
  }, []);

  const doTrade = useCallback(async () => {
    if (!meta || !account || !quote) return;
    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const router = meta.swapRouter;
      const weth = meta.weth;
      const fee = meta.poolFee;
      const tokenAddr = token.trim();
      const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

      // Slippage floor derived from the quote we just showed the user.
      const outMin =
        (BigInt(quote.amountOutRaw) * BigInt(100 - slippage)) / 100n;

      const isBuy = side === "buy";
      const amountInRaw = BigInt(quote.amountInRaw);

      if (!isBuy) {
        // Selling moves ERC-20 out of the wallet, so the router needs approval.
        setStatus("Checking approval…");
        const allowanceData = erc20Iface.encodeFunctionData("allowance", [account, router]);
        const eth = window.ethereum;
        const raw = await eth.request({
          method: "eth_call",
          params: [{ to: tokenAddr, data: allowanceData }, "latest"],
        });
        const allowance = BigInt(raw || "0x0");

        if (allowance < amountInRaw) {
          setStatus("Approve the router in your wallet…");
          const approveData = erc20Iface.encodeFunctionData("approve", [router, amountInRaw]);
          const approveHash = await sendTransaction({
            from: account,
            to: tokenAddr,
            data: approveData,
          });
          setStatus("Waiting for the approval to confirm…");
          await waitForReceipt(approveHash);
        }
      }

      const params = {
        tokenIn: isBuy ? weth : tokenAddr,
        tokenOut: isBuy ? tokenAddr : weth,
        fee,
        recipient: account,
        deadline,
        amountIn: amountInRaw,
        amountOutMinimum: outMin,
        sqrtPriceLimitX96: 0n,
      };

      const data = routerIface.encodeFunctionData("exactInputSingle", [params]);
      // Buying sends native ETH and lets the router wrap it.
      const value = isBuy ? "0x" + amountInRaw.toString(16) : undefined;

      setStatus("Simulating before spending anything…");
      const sim = await simulate({ from: account, to: router, data, value });
      if (!sim.ok) {
        setError(
          `Simulation reverted, so nothing was sent and no gas was spent: ${sim.reason}. ` +
            (side === "sell"
              ? "A reverting sell is the classic honeypot signature — run the audit on this token."
              : "The pool may be too thin for this size, or slippage too tight.")
        );
        setStatus(null);
        return;
      }

      setStatus("Confirm the swap in your wallet…");
      const hash = await sendTransaction({ from: account, to: router, data, value });
      setStatus("Waiting for confirmation…");
      const receipt = await waitForReceipt(hash);

      if (receipt.status === "0x0") {
        setError("The swap was mined but reverted. Nothing changed hands.");
      } else {
        setDone({ hash });
      }
      setStatus(null);
    } catch (err) {
      setError(humanError(err));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [meta, account, quote, token, side, slippage]);

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
          your wallet, simulated first, and never custodial — this site cannot move your funds.
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

          {!account ? (
            <div className="wallet-cta">
              <button className="btn btn-primary" onClick={doConnect} disabled={!hasWallet()}>
                Connect wallet
              </button>
              <span className="form-note">
                {hasWallet()
                  ? "Your wallet signs every swap. Nothing moves until you approve it."
                  : "No browser wallet detected. Install MetaMask or another EVM wallet."}
              </span>
            </div>
          ) : (
            <div className="form-note wallet-row">
              <span className="live-dot" /> {shortAddress(account)} · Robinhood Chain
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
              disabled={busy || !account || !quote}
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
                  {quote.minOutLabel ? quote.minOutLabel : "—"}
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
