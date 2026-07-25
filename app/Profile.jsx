"use client";

import { useCallback, useEffect, useState } from "react";
import { currentAccount, shortAddress } from "./wallet";
import { fmtEth, fmtQty, fmtUsd, usdOr } from "./format";

/**
 * Profile: who you are here, and what you are holding.
 *
 * The holdings come from the same terminal endpoint the `portfolio` command
 * uses, so the two can never disagree about what you own — one source, two
 * presentations.
 */
export default function Profile({ network, user, onSignIn, onNavigate }) {
  const [account, setAccount] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [folio, setFolio] = useState(null);
  const [ethUsd, setEthUsd] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    currentAccount().then(setAccount);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const connected = await currentAccount();
      setAccount(connected);

      if (user) {
        const res = await fetch(`/api/wallet?network=${encodeURIComponent(network)}`);
        if (res.ok) setWallet(await res.json());
      }

      // With neither identity there is nothing to price, and asking anyway just
      // returns a "no wallet" error that the cards below already say more
      // calmly. Being signed out is a state, not a failure.
      if (!user && !connected) {
        setFolio(null);
        return;
      }

      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "portfolio", network, account: connected }),
      });
      const json = await res.json();
      if (json.data) {
        setFolio(json.data);
        setEthUsd(json.ethUsd ?? null);
      } else if (json.lines?.length) {
        setError(json.lines.map((l) => l.text).join(" "));
      }
    } catch {
      setError("Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, [network, user]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <section className="hero hero-tight">
        <div className="eyebrow">
          <span className="live-dot" />
          Profile
        </div>
        <h1>
          {user ? (
            <>
              @{user.username}
              <span className="cursor" />
            </>
          ) : (
            <>
              Your bags, <em>priced</em>.
              <span className="cursor" />
            </>
          )}
        </h1>
        <p>
          Everything tied to you here: the wallet your X account mints, whatever browser wallet you
          have connected, and every launch either of them holds.
        </p>
      </section>

      <div className="console">
        <div className="console-bar">
          <span className="live-dot" />
          PROFILE
          <span className="nav-spacer" />
          <button className="btn btn-ghost" onClick={load} disabled={loading}>
            ↻
          </button>
        </div>

        <div className="console-body">
          {loading && (
            <div className="alert">
              <span className="spinner" />
              <span>Reading balances…</span>
            </div>
          )}

          {error && (
            <div className="alert alert-error">
              <span className="alert-icon">✖</span>
              <span>{error}</span>
            </div>
          )}

          <div className="prof-ids">
            <div className="prof-id">
              <div className="stat-label">X account</div>
              {user ? (
                <div className="prof-id-row">
                  {user.avatar && <img className="avatar" src={user.avatar} alt="" />}
                  <div>
                    <div className="prof-id-main">@{user.username}</div>
                    <div className="stat-sub">{user.name}</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="prof-id-main prof-id-off">not signed in</div>
                  <button className="btn btn-x" onClick={onSignIn} style={{ marginTop: 10 }}>
                    Sign in with X
                  </button>
                </>
              )}
            </div>

            <div className="prof-id">
              <div className="stat-label">X wallet</div>
              {wallet?.address ? (
                <>
                  <div className="prof-id-main prof-mono">{shortAddress(wallet.address)}</div>
                  <div className="stat-sub">
                    {wallet.balance
                      ? fmtEth(Number(wallet.balance.formatted), { symbol: "ETH" })
                      : "—"}
                  </div>
                </>
              ) : (
                <div className="prof-id-main prof-id-off">
                  {user ? "unavailable" : "sign in to mint one"}
                </div>
              )}
            </div>

            <div className="prof-id">
              <div className="stat-label">Browser wallet</div>
              <div className={`prof-id-main ${account ? "prof-mono" : "prof-id-off"}`}>
                {account ? shortAddress(account) : "not connected"}
              </div>
              <div className="stat-sub">
                {account ? "signs its own transactions" : "optional — the X wallet works too"}
              </div>
            </div>
          </div>

          {folio && (
            <>
              <div className="section-title">Holdings</div>

              <div className="stats">
                <div className="stat">
                  <div className="stat-label">Total value</div>
                  <div className="stat-value">{usdOr(folio.totalWeth, ethUsd)}</div>
                  <div className="stat-sub">ETH plus priced launches</div>
                </div>
                <div className="stat">
                  <div className="stat-label">ETH</div>
                  <div className="stat-value">{fmtEth(folio.eth, { symbol: "" })}</div>
                  <div className="stat-sub">
                    {ethUsd ? fmtUsd(folio.eth * ethUsd) : "no rate available"}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">Launches held</div>
                  <div className="stat-value">{folio.holdings.length}</div>
                  <div className="stat-sub">of {folio.scanned} scanned</div>
                </div>
              </div>

              {folio.holdings.length === 0 ? (
                <div className="alert">
                  <span className="alert-icon">·</span>
                  <span>
                    <strong>No launches held.</strong> Open the terminal and try{" "}
                    <code>buy $5 pons</code>, or browse the feed first.
                  </span>
                </div>
              ) : (
                <div className="prof-rows">
                  {folio.holdings.map((h) => (
                    <div className="prof-row" key={h.token}>
                      <div className="prof-row-sym">
                        ${(h.symbol || "???").replace(/^\$/, "")}
                        <span className="prof-row-name">{h.name}</span>
                      </div>
                      <div className="prof-row-qty">{fmtQty(h.qty)}</div>
                      <div className="prof-row-val">{usdOr(h.valueWeth, ethUsd)}</div>
                      <div className="prof-row-acts">
                        <button
                          className="btn btn-ghost tok-btn"
                          onClick={() => onNavigate?.({ view: "trade", token: h.token })}
                        >
                          Trade
                        </button>
                        <button
                          className="btn btn-ghost tok-btn"
                          onClick={() =>
                            onNavigate?.({ view: "audit", token: h.token, runAudit: true })
                          }
                        >
                          Audit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="form-note">
                Balances are read for launches inside the scanned block window only, so a very old
                position can be missing here even though it is still in the wallet.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
