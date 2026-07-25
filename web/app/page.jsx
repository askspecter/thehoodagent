"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Severity presentation. Each entry pairs a color with an ICON and a TEXT LABEL,
 * so severity is never communicated by color alone — required because the
 * `warning` and `serious` status hues sit close together.
 */
const SEVERITY = {
  critical: { icon: "✖", label: "CRITICAL", cls: "sev-critical", rank: 0 },
  high: { icon: "▲", label: "HIGH", cls: "sev-high", rank: 1 },
  medium: { icon: "▲", label: "MEDIUM", cls: "sev-medium", rank: 2 },
  low: { icon: "•", label: "LOW", cls: "sev-low", rank: 3 },
  good: { icon: "✔", label: "GOOD", cls: "sev-good", rank: 4 },
  info: { icon: "·", label: "INFO", cls: "sev-info", rank: 5 },
};

const VERDICT = {
  "LOW RISK": { icon: "✔", cls: "sev-good" },
  CAUTION: { icon: "▲", cls: "sev-medium" },
  "HIGH RISK": { icon: "▲", cls: "sev-high" },
  AVOID: { icon: "✖", cls: "sev-critical" },
};

const AUTH_ERRORS = {
  state_mismatch: "Sign-in expired or was tampered with. Please try again.",
  missing_code: "X did not return an authorization code.",
  token_exchange_failed: "Could not exchange the code with X. Check X_CLIENT_ID / X_CLIENT_SECRET.",
  profile_fetch_failed: "Signed in, but could not read your X profile.",
  access_denied: "You declined the X sign-in.",
  unexpected: "Something went wrong during sign-in.",
};

function XLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93zm-1.3 19.5h2.04L6.48 3.24H4.3z" />
    </svg>
  );
}

export default function Home() {
  const [user, setUser] = useState(null);
  const [authConfigured, setAuthConfigured] = useState(true);
  const [sessionError, setSessionError] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState("robinhood");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (err) {
      setAuthError(AUTH_ERRORS[err] || `Sign-in failed (${err}).`);
      window.history.replaceState({}, "", window.location.pathname);
    }

    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        setUser(data.user || null);
        setAuthConfigured(Boolean(data.configured));
        if (data.error) setSessionError(data.error);
      })
      .catch(() => setSessionError("Could not reach the server."))
      .finally(() => setLoadingSession(false));
  }, []);

  const runAudit = useCallback(async () => {
    const target = address.trim();
    if (!target) return;

    setBusy(true);
    setError(null);
    setReport(null);

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: target, network }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.hint ? `${data.error} ${data.hint}` : data.error || "Audit failed.");
      } else {
        setReport(data);
      }
    } catch {
      setError("Could not reach the audit API.");
    } finally {
      setBusy(false);
    }
  }, [address, network]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setReport(null);
  }, []);

  const findings = report
    ? [...report.findings].sort(
        (a, b) => (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9)
      )
    : [];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            pons<span>/</span>sentinel
          </div>
          <div className="brand-sub">Robinhood Chain · read-only</div>
        </div>

        {loadingSession ? (
          <span className="brand-sub">…</span>
        ) : user ? (
          <div className="user">
            {user.avatar && <img className="avatar" src={user.avatar} alt="" />}
            <span>@{user.username}</span>
            <button className="btn btn-ghost" onClick={logout}>
              Sign out
            </button>
          </div>
        ) : authConfigured ? (
          <a className="btn btn-x" href="/api/auth/x/login">
            <XLogo /> Sign in with X
          </a>
        ) : (
          <span className="brand-sub">X sign-in not configured</span>
        )}
      </header>

      <section className="hero">
        <h1>Find out if you can sell it — before you buy it.</h1>
        <p>
          Pons Sentinel simulates a full buy-then-sell round trip against the real pool on
          Robinhood Chain. If the sell reverts, the token is a honeypot and you learn that for
          free instead of with your money.
        </p>
        <p className="fine">
          Every check is read-only. This tool never asks for your wallet, never requests an
          approval, and cannot move funds.
        </p>
      </section>

      {sessionError && (
        <div className="alert alert-error">
          <span className="alert-icon">✖</span>
          <span>
            <strong>Setup incomplete.</strong> {sessionError}
          </span>
        </div>
      )}

      {authError && (
        <div className="alert alert-error">
          <span className="alert-icon">✖</span>
          <span>{authError}</span>
        </div>
      )}

      <div className="panel">
        <div className="form-row">
          <input
            className="input"
            placeholder="0x… token contract address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && user && !busy && runAudit()}
            spellCheck={false}
            aria-label="Token contract address"
          />
          <select
            className="select"
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            aria-label="Network"
          >
            <option value="robinhood">Robinhood Chain</option>
            <option value="robinhoodTestnet">Robinhood Testnet</option>
            <option value="local">Local EVM</option>
          </select>
          <button
            className="btn btn-primary"
            onClick={runAudit}
            disabled={busy || !user || !address.trim()}
          >
            {busy ? (
              <>
                <span className="spinner" />
                Auditing…
              </>
            ) : (
              "Run audit"
            )}
          </button>
        </div>
        <div className="form-note">
          {user
            ? "Simulates a 0.01 WETH round trip through the token's Uniswap V3 pool."
            : "Sign in with X to run an audit."}
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">✖</span>
          <span>{error}</span>
        </div>
      )}

      {report && <Report report={report} findings={findings} />}

      <footer className="disclaimer">
        <p>
          <strong>This is an automated heuristic scan, not financial advice and not a
          guarantee.</strong>{" "}
          A clean report means no trap was visible at the moment of the check. An owner who can
          change fees or apply a blacklist can trap you <em>after</em> you pass a clean audit.
        </p>
        <p>
          Most launchpad tokens go to zero regardless of whether their contract is technically
          safe. Contract safety and a good investment are different questions.
        </p>
        <p>
          Pons is not affiliated with Robinhood. Verify contract addresses against the official
          documentation, and type domains manually — lookalike launchpad domains are a common way
          wallets get drained.
        </p>
      </footer>
    </div>
  );
}

function Report({ report, findings }) {
  const score = report.score || {};
  const verdict = VERDICT[score.verdict] || VERDICT.CAUTION;
  const holders = report.holders || [];
  const maxPercent = holders.length ? Math.max(...holders.map((h) => h.percent)) : 0;

  return (
    <div className="result">
      <div className="token-head">
        <div>
          <h2 className="token-name">
            {report.token?.name || "Unknown"}{" "}
            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
              {report.token?.symbol ? `(${report.token.symbol})` : ""}
            </span>
          </h2>
          <div className="token-meta">
            {report.address}
            {report.explorer && (
              <>
                {" · "}
                <a href={report.explorer} target="_blank" rel="noopener noreferrer">
                  explorer ↗
                </a>
              </>
            )}
          </div>
          {report.token?.totalSupplyFormatted && (
            <div className="token-meta">
              supply {Number(report.token.totalSupplyFormatted).toLocaleString()}{" "}
              {report.token.symbol}
            </div>
          )}
        </div>
      </div>

      <div className="score-tile">
        <div className={`score-figure ${verdict.cls}`}>
          {score.score ?? "–"}
          <small>/100</small>
        </div>
        <div>
          <div className={`score-verdict ${verdict.cls}`}>
            <span className="score-icon" aria-hidden="true">
              {verdict.icon}
            </span>
            {score.verdict || "UNSCORED"}
          </div>
          <div className="score-blurb">{score.blurb}</div>
          {score.confidence === "partial" && (
            <div className="score-blurb sev-medium">
              ▲ Partial audit — some checks did not run. See “not checked” below.
            </div>
          )}
        </div>
      </div>

      <div className="section-title">Findings ({findings.length})</div>
      {findings.length === 0 ? (
        <p className="score-blurb">No findings returned.</p>
      ) : (
        findings.map((f, i) => {
          const sev = SEVERITY[f.severity] || SEVERITY.info;
          return (
            <div className="finding" key={`${f.id}-${i}`}>
              <div className={`finding-icon ${sev.cls}`} aria-hidden="true">
                {sev.icon}
              </div>
              <div className={`finding-label ${sev.cls}`}>{sev.label}</div>
              <div>
                <div className={`finding-title`} data-sev={sev.label}>
                  {f.title}
                </div>
                <div className="finding-detail">{f.detail}</div>
              </div>
            </div>
          );
        })
      )}

      {holders.length > 0 && (
        <>
          <div className="section-title">
            Holder concentration — share of supply
            {report.token?.transferCount != null && ` · ${report.token.transferCount} transfers seen`}
          </div>
          <div className="bars">
            {holders.map((h) => (
              <div
                className="bar-row"
                key={h.address}
                title={`${h.address} — ${h.percent.toFixed(2)}% of supply`}
              >
                <div className="bar-value">{h.percent.toFixed(2)}%</div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: maxPercent > 0 ? `${(h.percent / maxPercent) * 100}%` : "2px",
                    }}
                  />
                  <div className="bar-label">
                    {h.address.slice(0, 10)}…{h.address.slice(-6)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="form-note">
            A liquidity pool legitimately holds a large share. Check the top address on the
            explorer before reading concentration as malicious.
          </p>
        </>
      )}

      {report.incomplete?.length > 0 && (
        <>
          <div className="section-title">Not checked</div>
          {report.incomplete.map((note, i) => (
            <div className="alert alert-warn" key={i}>
              <span className="alert-icon">▲</span>
              <span>{note}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
