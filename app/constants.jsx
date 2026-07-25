"use client";

import { fmtEth, fmtUsdPrice, fullNumber, usdOr } from "./format";

/**
 * Shared UI constants and the audit-report components.
 *
 * These lived in the old single page.jsx. With the app split into routes they
 * are used from more than one place, the landing page, the audit route, and the
 * chrome, so they moved here to a single home.
 */

/**
 * Severity presentation. Each entry pairs a colour with an ICON and a TEXT
 * LABEL, so severity is never communicated by colour alone.
 */
export const SEVERITY = {
  critical: { icon: "✖", label: "CRITICAL", cls: "sev-critical", rank: 0 },
  high: { icon: "▲", label: "HIGH", cls: "sev-high", rank: 1 },
  medium: { icon: "▲", label: "MEDIUM", cls: "sev-medium", rank: 2 },
  low: { icon: "•", label: "LOW", cls: "sev-low", rank: 3 },
  good: { icon: "✔", label: "GOOD", cls: "sev-good", rank: 4 },
  info: { icon: "·", label: "INFO", cls: "sev-info", rank: 5 },
};

export const VERDICT = {
  "LOW RISK": { icon: "✔", cls: "sev-good" },
  CAUTION: { icon: "▲", cls: "sev-medium" },
  "HIGH RISK": { icon: "▲", cls: "sev-high" },
  AVOID: { icon: "✖", cls: "sev-critical" },
};

/** A graduated token with known on-chain state, handy as a one-click demo. */
export const EXAMPLE_TOKEN = "0x39dBED3a2bd333467115dE45665cC57F813C4571";

/** Scrolling command tape. Every line is a command the terminal accepts. */
export const TAPE = [
  ["buy me $5 sonic", "resolves the ticker, converts the dollars"],
  ["sell all sonic", "reads the balance, quotes the exit"],
  ["price sonic", "live pool price · market cap"],
  ["audit 0x…", "honeypot · owner-power scan"],
  ["portfolio", "every launch you hold, priced"],
  ["create SONIC", "fixed supply · locked WETH pool"],
];

export const STEPS = [
  {
    title: "Paste an address",
    body: "Only the contract address identifies a token. Names, symbols and images can be copied by anyone.",
  },
  {
    title: "The agent reads the chain",
    body: "Bytecode, owner, proxy slots, holders, and the launch record from the factory that deployed it. No off-chain index, no API to trust.",
  },
  {
    title: "It tries to sell",
    body: "A simulated buy and sell through the real pool. If the sell reverts, money goes in and cannot come out, and you found that out for free.",
  },
];

/** Where the app can take you. The tab strip and the mobile sheet both use it. */
export const DESTINATIONS = [
  { key: "terminal", label: "Terminal", href: "/terminal", hint: "buy me $5 sonic" },
  { key: "launches", label: "Launches", href: "/launches", hint: "the live feed" },
  { key: "create", label: "Create", href: "/create", hint: "deploy a token" },
  { key: "trade", label: "Trade", href: "/trade", hint: "the manual form" },
  { key: "audit", label: "Audit", href: "/audit", hint: "can you sell it?" },
  { key: "profile", label: "Profile", href: "/profile", hint: "your bags, priced" },
];

export const EXTERNAL_LINKS = [
  { href: "https://robinhoodchain.blockscout.com", label: "Explorer" },
  { href: "https://ponsfamily.com", label: "pons" },
];

export const AUTH_ERRORS = {
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
export const ENV_HELP = {
  X_CLIENT_ID: "developer.x.com → your project → Keys and tokens → OAuth 2.0 Client ID",
  X_CLIENT_SECRET: "the same screen; the app must be a confidential “Web App” client",
  SESSION_SECRET:
    "any 32+ character random string: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
};

export function XLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93zm-1.3 19.5h2.04L6.48 3.24H4.3z" />
    </svg>
  );
}

/** A failed sign-in, explained, names the missing variable and the callback URL. */
export function AuthProblem({ message, setup, onDismiss }) {
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
                  {ENV_HELP[name] ? `, ${ENV_HELP[name]}` : null}
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
                ? "This was worked out from the request, so it already matches this deployment, set X_REDIRECT_URI only if you serve the app on a different public URL."
                : "This came from X_REDIRECT_URI."}
            </p>
          </>
        )}
        <p className="form-note" style={{ marginTop: 6 }}>
          On Vercel these live under Settings → Environment Variables, and a redeploy is needed
          before they take effect. Everything except the wallet works without signing in.
        </p>
        <button className="btn btn-ghost" onClick={onDismiss} style={{ marginTop: 8 }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** Live launch state read straight off the pons contracts. */
export function LaunchPanel({ launch, report }) {
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
          <div className="stat-sub">{fmtEth(launch.marketCapWeth)} · = FDV (nothing vests)</div>
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
              {fees.creatorSharePercent}/{fees.protocolSharePercent ?? ","}
            </div>
            <div className="stat-sub">creator / protocol</div>
          </div>
        )}
      </div>

      {grad && (
        <div className="meter">
          <div className="meter-head">
            <span>
              {grad.graduated ? "✔ Graduated" : "Graduation progress"}, threshold is a liquidity
              marker, not a safety signal
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
          Launch protection is still active until block {launch.restrictionsEndBlock}: max 5% held
          and 5.5% bought per wallet. Selling is never restricted.
        </p>
      )}

      {fees?.redirected && (
        <p className="form-note">
          Creator fees are redirected to {fees.creatorPayout} rather than the deployer, normal
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
              style={{ color: "var(--lime)" }}
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

export function Report({ report, findings }) {
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
              ▲ Partial audit, some checks did not run. See “not checked” below.
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
                <div className="finding-title" data-sev={sev.label}>
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
            Holder concentration, share of supply
            {report.token?.transferCount != null &&
              ` · ${report.token.transferCount} transfers seen`}
          </div>
          <div className="bars">
            {holders.map((h) => (
              <div
                className="bar-row"
                key={h.address}
                title={`${h.address}, ${h.percent.toFixed(2)}% of supply`}
              >
                <div className="bar-value">{h.percent.toFixed(2)}%</div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: maxPercent > 0 ? `${(h.percent / maxPercent) * 100}%` : "2px" }}
                  />
                  <div className="bar-label">
                    {h.address.slice(0, 10)}…{h.address.slice(-6)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="form-note">
            A liquidity pool legitimately holds a large share. Check the top address on the explorer
            before reading concentration as malicious.
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
