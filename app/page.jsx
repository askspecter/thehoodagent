"use client";

import { useCallback, useEffect, useState } from "react";
import LaunchFeed from "./LaunchFeed";
import LaunchForm from "./LaunchForm";
import Menu from "./Menu";
import Profile from "./Profile";
import Terminal from "./Terminal";
import TradePanel from "./TradePanel";
import WalletPanel from "./WalletPanel";
import { fmtEth, fmtUsdPrice, fullNumber, usdOr } from "./format";

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

/**
 * Scrolling command tape. Rendered twice so the marquee loops seamlessly.
 * Every line is a command the terminal actually accepts — a tape advertising
 * something you cannot then type would be a lie in the furniture.
 */
const TAPE = [
  ["buy me $5 pons", "resolves the ticker, converts the dollars"],
  ["sell all pons", "reads the balance, quotes the exit"],
  ["price pons", "live pool price · market cap"],
  ["audit", "0x39dB…4571"],
  ["portfolio", "every launch you hold, priced"],
  ["create HOOD", "fixed supply · locked WETH pool"],
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
    title: "Plain-language trading",
    live: true,
    body: "“buy me $5 nvda” is a complete instruction. The ticker resolves against the live feed, dollars convert at the current ETH rate, the pool quotes the fill, and you confirm a plan with the worst case written on it.",
  },
  {
    title: "Trade from the terminal",
    live: true,
    body: "Buy and sell through the pons router against the token's own locked WETH pool. Quoted first, simulated second, signed either in your browser wallet or in the wallet your X account mints.",
  },
  {
    title: "Commands from X",
    live: false,
    body: "Mention the bot in a post and have it act. The custody half is now solved — an X account already has a wallet here — what is left is the listener and the confirmation flow.",
  },
  {
    title: "Create a token",
    live: true,
    body: "Deploy through the pons factory — fixed 1B supply, WETH pool and locked liquidity in one transaction. The form is built from the factory's own verified ABI, so nothing about the call is guessed.",
  },
];

/**
 * Every destination in the app, in one list.
 *
 * The tab strip and the mobile sheet both render from this. They used to carry
 * separate hand-written lists, which is how the strip ended up showing five of
 * the seven views while the menu showed all of them.
 */
const DESTINATIONS = [
  { key: "terminal", label: "Terminal", hint: "buy me $5 pons" },
  { key: "launches", label: "Launches", hint: "the live feed" },
  { key: "create", label: "Create", hint: "deploy a token" },
  { key: "trade", label: "Trade", hint: "the manual form" },
  { key: "audit", label: "Audit", hint: "can you sell it?" },
  { key: "profile", label: "Profile", hint: "your bags, priced" },
  { key: "wallet", label: "Wallet", hint: "address · export key" },
];

const EXTERNAL_LINKS = [
  { href: "https://robinhoodchain.blockscout.com", label: "Explorer" },
  { href: "https://ponsfamily.com", label: "pons" },
];

const AUTH_ERRORS = {
  not_configured: "X sign-in is not finished being set up on this deployment.",
  state_mismatch: "Sign-in expired or was tampered with. Please try again.",
  missing_code: "X did not return an authorization code.",
  token_exchange_failed:
    "X refused the code exchange. Usually the callback URL registered with X does not match the one below, or X_CLIENT_SECRET is wrong.",
  profile_fetch_failed: "Signed in, but could not read your X profile.",
  access_denied: "You declined the X sign-in.",
  unexpected: "Something went wrong during sign-in.",
};

/** Where each variable comes from, so a broken sign-in names its own fix. */
const ENV_HELP = {
  X_CLIENT_ID: "developer.x.com → your project → Keys and tokens → OAuth 2.0 Client ID",
  X_CLIENT_SECRET: "the same screen — the app must be a confidential “Web App” client",
  SESSION_SECRET:
    "any 32+ character random string: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
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
  const [setup, setSetup] = useState(null);
  const [sessionError, setSessionError] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const [view, setView] = useState("terminal");
  const [tradeToken, setTradeToken] = useState("");
  const [createPrefill, setCreatePrefill] = useState(null);
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
        setSetup(data.setup || null);
        if (data.error) setSessionError(data.error);
      })
      .catch(() => setSessionError("Could not reach the server."))
      .finally(() => setLoadingSession(false));
  }, []);

  const signIn = useCallback(() => {
    window.location.href = "/api/auth/x/login";
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

  /**
   * One place the terminal — and anything else — hands control to another view.
   * Keeping it in a single callback is what stops `audit 0x…` from typing an
   * address into the audit box on one path and running it on another.
   */
  const navigate = useCallback(
    (intent) => {
      if (!intent?.view) return;
      if (intent.view === "trade" && intent.token) setTradeToken(intent.token);
      if (intent.view === "create" && intent.prefill) setCreatePrefill(intent.prefill);
      if (intent.view === "audit" && intent.token) {
        setAddress(intent.token);
        setView("audit");
        window.scrollTo({ top: 0, behavior: "smooth" });
        if (intent.runAudit) runAudit(intent.token);
        return;
      }
      setView(intent.view);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [runAudit]
  );

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
          <button className="brand" onClick={() => setView("terminal")} aria-label="Home">
            <span className="brand-mark">
              <img className="brand-logo" src="/cable.png" alt="" />
              CABLE
            </span>
          </button>

          <div className="topbar-right">
            {loadingSession ? (
              <span className="topbar-wait" aria-label="Loading session">
                …
              </span>
            ) : user ? (
              <div className="user">
                {user.avatar && <img className="avatar" src={user.avatar} alt="" />}
                <button className="user-handle" onClick={() => setView("profile")}>
                  @{user.username}
                </button>
                <button className="btn btn-ghost topbar-wide" onClick={logout}>
                  Sign out
                </button>
              </div>
            ) : (
              /* Always rendered. Hiding it when credentials are absent made the
                 site look like it had no sign-in at all; if X is not configured
                 the route now redirects back here with a setup panel. */
              <a className="btn btn-x topbar-wide" href="/api/auth/x/login">
                <XLogo /> Sign in with X
              </a>
            )}

            {/* Below the nav breakpoint only. The tab strip is the navigation on
                a wide screen, and listing the same destinations twice is what
                made the header look cluttered. */}
            <Menu
              items={[
                ...DESTINATIONS.map(({ key, label, hint }) => ({
                  key,
                  label,
                  hint,
                  active: view === key,
                  onSelect: () => setView(key),
                })),
                ...(user
                  ? [{ key: "signout", label: "Sign out", hint: `@${user.username}`, onSelect: logout }]
                  : []),
              ]}
              links={EXTERNAL_LINKS}
              account={
                user ? (
                  <div className="menu-user">
                    {user.avatar && <img className="avatar" src={user.avatar} alt="" />}
                    <span>
                      <span className="menu-user-handle">@{user.username}</span>
                      <span className="menu-user-sub">signed in with X</span>
                    </span>
                  </div>
                ) : (
                  <a className="btn btn-x menu-signin" href="/api/auth/x/login">
                    <XLogo /> Sign in with X
                  </a>
                )
              }
              footer="Not affiliated with Robinhood. Nothing here is financial advice."
            />
          </div>
        </header>

        {/* The tab strip is the navigation at wide widths and is hidden below the
            breakpoint, where the sheet takes over. Exactly one of the two is on
            screen at any width. */}
        <nav className="nav">
          {DESTINATIONS.map(({ key, label }) => (
            <button
              key={key}
              className={`nav-tab ${view === key ? "nav-on" : ""}`}
              onClick={() => setView(key)}
              aria-current={view === key ? "page" : undefined}
            >
              {label}
            </button>
          ))}
          <span className="nav-spacer" />
          {EXTERNAL_LINKS.map((link) => (
            <a
              key={link.href}
              className="nav-tab nav-ext"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label} <span aria-hidden="true">↗</span>
            </a>
          ))}
        </nav>

        {authError && (
          <AuthProblem
            message={authError}
            setup={setup}
            onDismiss={() => setAuthError(null)}
          />
        )}

        {view === "terminal" && (
          <Terminal
            network={network}
            user={user}
            onNavigate={navigate}
            onSignIn={signIn}
          />
        )}

        {view === "launches" && (
          <LaunchFeed
            network={network}
            onAudit={auditFromFeed}
            onTrade={tradeFromFeed}
            nonce={feedNonce}
          />
        )}

        {view === "create" && (
          <LaunchForm
            network={network}
            prefill={createPrefill}
            onLaunched={() => {
              setFeedNonce((n) => n + 1);
              setCreatePrefill(null);
              setView("launches");
            }}
          />
        )}

        {view === "trade" && <TradePanel network={network} token={tradeToken} />}

        {view === "profile" && (
          <Profile network={network} user={user} onSignIn={signIn} onNavigate={navigate} />
        )}

        {view === "wallet" && (
          <WalletPanel network={network} user={user} onSignIn={signIn} />
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
          Automated heuristic scan — not financial advice. Read-only. CABLE is an interface, not
          affiliated with Robinhood or pons.
        </footer>
      </div>
    </>
  );
}

/**
 * A failed sign-in, explained.
 *
 * What a visitor used to get was the login route's raw JSON 500 rendered as
 * plain text in the browser — a dead end that looked like the site was broken.
 * The route now redirects back here, and this says which variable is missing and
 * the exact callback URL to register with X, which is the other half of why
 * sign-in fails in practice.
 */
function AuthProblem({ message, setup, onDismiss }) {
  const missing = setup?.missing || [];

  return (
    <div className="alert alert-error auth-problem">
      <span className="alert-icon">✖</span>
      <div>
        <strong>Could not sign in with X.</strong> {message}
        {missing.length > 0 && (
          <>
            <div className="auth-problem-title">Not set on this deployment</div>
            <ul className="auth-problem-list">
              {missing.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                  {ENV_HELP[name] ? ` — ${ENV_HELP[name]}` : null}
                </li>
              ))}
            </ul>
          </>
        )}
        {setup?.callbackUrl && (
          <>
            <div className="auth-problem-title">Callback URL to register with X</div>
            <div className="auth-problem-url">{setup.callbackUrl}</div>
            <p className="form-note" style={{ marginTop: 6 }}>
              It must match what X has registered exactly, including the scheme and path.{" "}
              {setup.callbackSource === "derived"
                ? "This was worked out from the request, so it already matches this deployment — set X_REDIRECT_URI only if you serve the app on a different public URL."
                : "This came from X_REDIRECT_URI."}
            </p>
          </>
        )}
        <p className="form-note" style={{ marginTop: 6 }}>
          On Vercel these live under Settings → Environment Variables, and a redeploy is needed
          before they take effect. Everything except the wallet and the launch form works without
          signing in.
        </p>
        <button className="btn btn-ghost" onClick={onDismiss} style={{ marginTop: 8 }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** Live launch state read straight off the pons contracts. */
function LaunchPanel({ launch, report }) {
  const grad = launch.graduation;
  const fees = launch.fees;
  const socials = launch.socials || {};
  const socialLinks = Object.entries(socials).filter(([, v]) => v && v.trim());
  const ethUsd = report.ethUsd ?? null;

  return (
    <>
      <div className="section-title">
        pons launch · {launch.generation} factory
        {launch.generation === "legacy" && " (90/10 split)"}
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Price</div>
          <div className="stat-value" title={fullNumber(launch.priceInWeth, "WETH")}>
            {usdOr(launch.priceInWeth, ethUsd, fmtUsdPrice)}
          </div>
          <div className="stat-sub">{fmtEth(launch.priceInWeth)} per token</div>
        </div>
        <div className="stat">
          <div className="stat-label">Market cap</div>
          <div className="stat-value" title={fullNumber(launch.marketCapWeth, "WETH")}>
            {usdOr(launch.marketCapWeth, ethUsd)}
          </div>
          <div className="stat-sub">
            {fmtEth(launch.marketCapWeth)} · = FDV (nothing vests)
          </div>
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
              supply {Number(report.token.totalSupplyFormatted).toLocaleString("en-US")}{" "}
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
