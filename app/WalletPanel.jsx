"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The X wallet panel.
 *
 * Signing in with X mints a wallet tied to that account — no seed phrase. This is
 * where its owner sees the address, funds it, and exports the key to take it
 * elsewhere.
 */
export default function WalletPanel({ network, user, onSignIn }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [exported, setExported] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/wallet?network=${encodeURIComponent(network)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error);
      else setData(json);
    } catch {
      setError("Could not reach the wallet endpoint.");
    } finally {
      setLoading(false);
    }
  }, [network, user]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = useCallback(async () => {
    if (!data?.address) return;
    try {
      await navigator.clipboard.writeText(data.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the address is on screen to copy by hand */
    }
  }, [data]);

  const doExport = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/export", { method: "POST" });
      const json = await res.json();
      if (!res.ok) setError(json.error);
      else setExported(json);
    } catch {
      setError("Could not export the key.");
    } finally {
      setExporting(false);
      setConfirmExport(false);
    }
  }, []);

  if (!user) {
    return (
      <>
        <section className="hero hero-tight">
          <div className="eyebrow">Wallet · tied to your X account</div>
          <h1>
            Sign in with X. <em>Get a wallet.</em>
          </h1>
          <p>
            No seed phrase, no setup. Your wallet is derived from your X account, so it is the same
            wallet every time you come back — and you can export the key whenever you want it
            somewhere else.
          </p>
        </section>
        <div className="console">
          <div className="console-bar">WALLET · NOT SIGNED IN</div>
          <div className="console-body">
            <div className="wallet-cta">
              <button className="btn btn-x" onClick={onSignIn}>
                Sign in with X
              </button>
              <span className="form-note">
                We store only your handle, id and avatar. The access token is discarded.
              </span>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <section className="hero hero-tight">
        <div className="eyebrow">
          <span className="live-dot" />
          Wallet · @{user.username}
        </div>
        <h1>
          Your wallet, <em>your key</em>.
        </h1>
      </section>

      <div className="console">
        <div className="console-bar">
          <span className="live-dot" />
          WALLET {data?.chain ? `· ${data.chain}` : ""}
        </div>
        <div className="console-body">
          {loading && (
            <div className="alert">
              <span className="spinner" />
              <span>Deriving your wallet…</span>
            </div>
          )}

          {error && (
            <div className="alert alert-error">
              <span className="alert-icon">✖</span>
              <span>{error}</span>
            </div>
          )}

          {data && (
            <>
              <div className="wal-head">
                {user.avatar && <img className="wal-avatar" src={user.avatar} alt="" />}
                <div className="wal-id">
                  <div className="wal-handle">@{data.handle}</div>
                  <button className="wal-addr" onClick={copy} title="Copy address">
                    {data.address} <span className="wal-copy">{copied ? "copied ✓" : "copy"}</span>
                  </button>
                </div>
                <button className="btn btn-ghost" onClick={load} disabled={loading}>
                  ↻
                </button>
              </div>

              <div className="wal-balance">
                <div className="stat-label">Total balance</div>
                <div className="wal-figure">
                  {data.balance
                    ? `${Number(data.balance.formatted).toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })} ${data.gasSymbol}`
                    : "—"}
                </div>
                {data.balanceError && <div className="stat-sub sev-medium">▲ {data.balanceError}</div>}
              </div>

              <div className="wal-actions">
                <div className="wal-act">
                  <div className="wal-act-title">Receive</div>
                  <div className="wal-act-body">
                    Send ETH or any Robinhood Chain token to the address above.
                  </div>
                </div>
                <div className="wal-act">
                  <div className="wal-act-title">Fund</div>
                  <div className="wal-act-body">
                    Bridge or transfer ETH in. You need it for gas and for buys.
                  </div>
                </div>
                <div className="wal-act">
                  <div className="wal-act-title">Trade</div>
                  <div className="wal-act-body">
                    Use the Trade tab, or Launch to deploy a token from this wallet.
                  </div>
                </div>
                {data.explorer && (
                  <a
                    className="wal-act wal-act-link"
                    href={`${data.explorer}/address/${data.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="wal-act-title">Explorer ↗</div>
                    <div className="wal-act-body">
                      Every transaction this wallet has ever made, on chain.
                    </div>
                  </a>
                )}
              </div>

              <div className="section-title">Export private key</div>

              {!exported && !confirmExport && (
                <div className="wallet-cta">
                  <button className="btn" onClick={() => setConfirmExport(true)}>
                    Export private key
                  </button>
                  <span className="form-note">
                    Takes this wallet fully into your control — import it into MetaMask or anything
                    else.
                  </span>
                </div>
              )}

              {confirmExport && !exported && (
                <div className="alert alert-warn">
                  <span className="alert-icon">▲</span>
                  <span>
                    <strong>The key will appear on screen.</strong> Anyone who sees it — over your
                    shoulder, in a screenshot, in a screen recording — controls this wallet forever.
                    It stays valid even after you sign out.
                    <div className="launch-foot">
                      <button className="btn btn-primary" onClick={doExport} disabled={exporting}>
                        {exporting ? (
                          <>
                            <span className="spinner" />
                            Deriving…
                          </>
                        ) : (
                          "Show it"
                        )}
                      </button>
                      <button className="btn btn-ghost" onClick={() => setConfirmExport(false)}>
                        Cancel
                      </button>
                    </div>
                  </span>
                </div>
              )}

              {exported && (
                <>
                  <div className="wal-key">{exported.privateKey}</div>
                  <div className="alert alert-warn">
                    <span className="alert-icon">▲</span>
                    <span>{exported.warning}</span>
                  </div>
                  <div className="launch-foot">
                    <button className="btn btn-ghost" onClick={() => setExported(null)}>
                      Hide it
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
