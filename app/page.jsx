"use client";

import { useCallback, useEffect, useState } from "react";
import LaunchFeed from "./LaunchFeed";
import LaunchForm from "./LaunchForm";
import TradePanel from "./TradePanel";
import WalletPanel from "./WalletPanel";

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

/**
 * A graduated token pons publishes specifically so an integration can be checked
 * against known on-chain state. Perfect one-click demo: a visitor sees a real
 * report before typing anything.
 */
const EXAMPLE_TOKEN = "0x39dBED3a2bd333467115dE45665cC57F813C4571";

/** Scrolling command tape. Rendered twice so the marquee loops seamlessly. */
const TAPE = [
  ["audit", "0x39dB…4571"],
  ["simulate sell", "0.01 WETH round trip"],
  ["scan", "mint · blacklist · pause"],
  ["holders", "top 10 concentration"],
  ["launch state", "graduation · fee split"],
  ["verify", "deployed by pons?"],
];

const STEPS = [
  {
    title: "Paste an address",
    body: "Only the contract address identifies a token. Names, symbols and images can be copied by anyone — the pons docs say so themselves.",
  },
  {
    title: "The agent reads the chain",
    body: "Bytecode, owner, proxy slots, holders, and the launch record from the factory that deployed it. No off-chain index, no API to trust.",
  },
  {
    title: "It tries to sell",
    body: "A simulated buy and sell through the real pool. If the sell reverts, money goes in and cannot come out — and you found that out for free.",
  },
];

/**
 * What the agent can do. `live` is the honest bit: it means the capability works
 * right now, in this deployment. Anything else says planned, so the page never
 * implies a feature that is not wired up.
 */
const CAPS = [
  {
    title: "Honeypot simulation",
    live: true,
    body: "Quotes a buy and a sell through the real Uniswap V3 pool. The quote runs the token's own transfer logic, so a sell block surfaces as a reverting sell — spending nothing and granting no approval.",
  },
  {
    title: "Sell-tax measurement",
    live: true,
    body: "Round-trip loss. Around 2–4% is normal pool fees. 20%+ means a transfer tax is eating your trade; 50%+ is a soft honeypot — technically sellable, practically not.",
  },
  {
    title: "Owner-power scan",
    live: true,
    body: "Reads PUSH4 selectors straight out of the deployed dispatcher to find mint, blacklist, pause, setFee, setMaxTxAmount. Works on unverified contracts, which is most of a launchpad.",
  },
  {
    title: "Proxy & ownership",
    live: true,
    body: "Renounced ownership counts in a token's favour. A live owner holding privileged functions is the worst case. Upgradeable logic can gain a sell block after you buy.",
  },
  {
    title: "Holder concentration",
    live: true,
    body: "Replays Transfer events and ranks holders. A pool legitimately holds a large share, so this is flagged for review rather than called malice.",
  },
  {
    title: "pons launch record",
    live: true,
    body: "Exact pool and fee tier from the deploying factory, graduation progress, creator fee split, payout wallet, and whether launch protection is still active.",
  },
  {
    title: "Trade from the terminal",
    live: true,
    body: "Buy and sell through the pons router against the token's own locked WETH pool. Quoted first, simulated second, signed in your own wallet — this site never holds your funds.",
  },
  {
    title: "Commands from X",
    live: false,
    body: "Mention the bot in a post and have it act. Still to build: it needs a wallet the server can sign with while you are away, so the custody model has to be chosen first.",
  },
  {
    title: "Launch a token",
    live: true,
    body: "Deploy through the pons factory — fixed 1B supply, WETH pool and locked liquidity in one transaction. The form is built from the factory's own verified ABI, so nothing about the call is guessed.",
  },
];

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

  const [view, setView] = useState("launches");
  const [tradeToken, setTradeToken] = useState("");
  const [feedNonce, setFeedNonce] = useState(0);
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

  /**
   * `override` lets a launch card audit its own token without waiting for the
   * input's state to settle — passing the address straight through avoids
   * auditing whatever happened to be in the box a render ago.
   */
  const runAudit = useCallback(
    async (override) => {
      const target = (typeof override === "string" ? override : address).trim();
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
    },
    [address, network]
  );

  /** Audit a token straight from its card in the launch feed. */
  const auditFromFeed = useCallback(
    (tokenAddress) => {
      setView("audit");
      setAddress(tokenAddress);
      window.scrollTo({ top: 0, behavior: "smooth" });
      runAudit(tokenAddress);
    },
    [runAudit]
  );

  /** Trade a token straight from its card. */
  const tradeFromFeed = useCallback((tokenAddress) => {
    setTradeToken(tokenAddress);
    setView("trade");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

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
    <>
      {/* Command tape. The list is duplicated so the marquee loops seamlessly. */}
      <div className="tape" aria-hidden="true">
        <div className="tape-track">
          {[...TAPE, ...TAPE].map(([cmd, arg], i) => (
            <span className="tape-item" key={i}>
              <b>▸ {cmd}</b> {arg}
            </span>
          ))}
        </div>
      </div>

      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">
              pons<span>/</span>sentinel
            </div>
            <div className="brand-sub">ROBINHOOD CHAIN · CHAIN ID 4663</div>
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
          ) : (
            /* Always rendered. Hiding it when credentials are absent made the
               site look like it had no sign-in at all; if X is not configured
               the route returns a clear setup error instead. */
            <a className="btn btn-x" href="/api/auth/x/login">
              <XLogo /> Sign in with X
            </a>
          )}
        </header>

        <nav className="nav">
          {[
            ["launches", "Launches"],
            ["launch", "Launch"],
            ["trade", "Trade"],
            ["audit", "Audit"],
            ["wallet", "Wallet"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`nav-tab ${view === key ? "nav-on" : ""}`}
              onClick={() => setView(key)}
              aria-current={view === key ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>

        {view === "launches" && (
          <LaunchFeed
            network={network}
            onAudit={auditFromFeed}
            onTrade={tradeFromFeed}
            nonce={feedNonce}
          />
        )}

        {view === "launch" && (
          <LaunchForm
            network={network}
            onLaunched={() => {
              setFeedNonce((n) => n + 1);
              setView("launches");
            }}
          />
        )}

        {view === "trade" && <TradePanel network={network} token={tradeToken} />}

        {view === "wallet" && (
          <WalletPanel
            network={network}
            user={user}
            onSignIn={() => {
              window.location.href = "/api/auth/x/login";
            }}
          />
        )}

        {view === "audit" && (
        <>
        <section className="hero">
          <div className="eyebrow">
            <span className="live-dot" />
            Reading Robinhood Chain live
          </div>
          <h1>
            Find out if you can <em>sell it</em> before you buy it.
            <span className="cursor" />
          </h1>
          <p>
            Every launch looks the same until you try to leave. This agent simulates a full
            buy-then-sell round trip against the real pool — if the sell reverts, the token is a
            honeypot, and you found out for free instead of with your money.
          </p>
          <p className="fine">
            Read-only. It never asks for your wallet, never requests an approval, and cannot move
            funds.
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

      <div className="console">
        <div className="console-bar">
          <span className="live-dot" />
          AGENT · READY
        </div>
        <div className="console-body">
          <div className="form-row">
            <input
              className="input"
              placeholder="0x… token contract address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && address.trim() && runAudit()}
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
              disabled={busy || !address.trim()}
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
            Simulates a 0.01 WETH round trip through the token's Uniswap V3 pool.{" "}
            <button
              className="link-btn"
              onClick={() => {
                setNetwork("robinhood");
                setAddress(EXAMPLE_TOKEN);
              }}
            >
              Try it with $PONS
            </button>
            {!user && " · No sign-in needed. Signing in with X raises the rate limit."}
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">✖</span>
          <span>{error}</span>
        </div>
      )}

      {report && <Report report={report} findings={findings} />}

      {!report && !busy && (
        <>
          <div className="section-title">How it works</div>
          <div className="steps">
            {STEPS.map((step, i) => (
              <div className="step" key={step.title}>
                <div className="step-num">0{i + 1}</div>
                <div className="step-title">{step.title}</div>
                <div className="step-body">{step.body}</div>
              </div>
            ))}
          </div>

          <div className="section-title">Capabilities</div>
          <div className="caps">
            {CAPS.map((cap) => (
              <div className="cap" key={cap.title}>
                <div className="cap-head">
                  <div className="cap-title">{cap.title}</div>
                  {/* Status is a word, not a colour — "planned" is never dressed as live. */}
                  <div className={`cap-status ${cap.live ? "cap-live" : "cap-planned"}`}>
                    {cap.live ? "LIVE" : "PLANNED"}
                  </div>
                </div>
                <div className="cap-body">{cap.body}</div>
              </div>
            ))}
          </div>

          <div className="section-title">What it cannot tell you</div>
          <div className="panel">
            <ul className="limits">
              <li>
                A trap keyed on your address, the block number, or an allowlist can quote
                clean and still fail for you in a real transaction.
              </li>
              <li>
                A blacklist can be applied <em>after</em> you pass a clean audit. An owner
                who can raise the fee can do it the minute you buy.
              </li>
              <li>
                Contract safety is not investment quality. Most launchpad tokens go to zero
                with completely ordinary contracts.
              </li>
            </ul>
          </div>
        </>
      )}

        </>
        )}

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
    </>
  );
}

/** Live launch state read straight off the pons contracts. */
function LaunchPanel({ launch, report }) {
  const grad = launch.graduation;
  const fees = launch.fees;
  const socials = launch.socials || {};
  const socialLinks = Object.entries(socials).filter(([, v]) => v && v.trim());

  const fmt = (n, digits = 6) =>
    n == null || !Number.isFinite(n)
      ? "—"
      : n < 0.000001
        ? n.toExponential(2)
        : n.toLocaleString(undefined, { maximumFractionDigits: digits });

  return (
    <>
      <div className="section-title">
        pons launch · {launch.generation} factory
        {launch.generation === "legacy" && " (90/10 split)"}
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Price</div>
          <div className="stat-value">{fmt(launch.priceInWeth, 10)}</div>
          <div className="stat-sub">WETH per token</div>
        </div>
        <div className="stat">
          <div className="stat-label">Market cap</div>
          <div className="stat-value">{fmt(launch.marketCapWeth, 3)}</div>
          <div className="stat-sub">WETH · = FDV (fixed supply)</div>
        </div>
        <div className="stat">
          <div className="stat-label">Pool fee</div>
          <div className="stat-value">{(launch.poolFee / 10_000).toFixed(2)}%</div>
          <div className="stat-sub">Uniswap V3 tier</div>
        </div>
        {fees && (
          <div className="stat">
            <div className="stat-label">Fee split</div>
            <div className="stat-value">
              {fees.creatorSharePercent}/{fees.protocolSharePercent ?? "—"}
            </div>
            <div className="stat-sub">creator / protocol</div>
          </div>
        )}
      </div>

      {grad && (
        <div className="meter">
          <div className="meter-head">
            <span>
              {grad.graduated ? "✔ Graduated" : "Graduation progress"} — threshold is a
              liquidity marker, not a safety signal
            </span>
            <span className="meter-num">
              {Number(grad.pairedEth).toFixed(3)} / {Number(grad.thresholdEth).toFixed(2)} ETH
            </span>
          </div>
          <div
            className="meter-track"
            role="meter"
            aria-valuenow={Math.round(grad.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Graduation progress"
          >
            <div
              className="meter-fill"
              style={{ width: `${Math.min(100, Math.max(0, grad.progress * 100))}%` }}
            />
          </div>
        </div>
      )}

      {launch.protectionActive && (
        <p className="form-note">
          Launch protection is still active until block {launch.restrictionsEndBlock}: max 5%
          held and 5.5% bought per wallet. Selling is never restricted.
        </p>
      )}

      {fees?.redirected && (
        <p className="form-note">
          Creator fees are redirected to {fees.creatorPayout} rather than the deployer — normal
          after a community takeover, but worth knowing who is paid.
        </p>
      )}

      {launch.deployer && (
        <p className="form-note">
          Deployer{" "}
          {report.explorer ? (
            <a
              href={`${report.explorer.split("/address/")[0]}/address/${launch.deployer}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--bar)" }}
            >
              {launch.deployer}
            </a>
          ) : (
            launch.deployer
          )}
        </p>
      )}

      {socialLinks.length > 0 && (
        <div className="socials">
          {socialLinks.map(([name, value]) => (
            <span className="social-chip" key={name} title={value}>
              {name}: {value}
            </span>
          ))}
        </div>
      )}
    </>
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

      {report.launch?.isPonsLaunch && <LaunchPanel launch={report.launch} report={report} />}

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
