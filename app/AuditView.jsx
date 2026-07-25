"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "./session";
import { EXAMPLE_TOKEN, Report, SEVERITY, STEPS } from "./constants";

/**
 * The audit route.
 *
 * Read-only: it never asks for a wallet, never requests an approval, and cannot
 * move funds. A token address may arrive in the URL (`/audit?token=0x…&run=1`)
 * from a launch card or a terminal command, in which case the audit runs on
 * arrival.
 */

const CAPS = [
  {
    title: "Honeypot simulation",
    live: true,
    body: "Quotes a buy and a sell through the real Uniswap V3 pool. The quote runs the token's own transfer logic, so a sell block surfaces as a reverting sell, spending nothing and granting no approval.",
  },
  {
    title: "Sell-tax measurement",
    live: true,
    body: "Round-trip loss. Around 2–4% is normal pool fees. 20%+ means a transfer tax is eating your trade; 50%+ is a soft honeypot, technically sellable, practically not.",
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
];

export default function AuditView() {
  const { user } = useSession();
  const params = useSearchParams();

  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState("robinhood");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

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

  // A token handed in via the URL audits itself on arrival.
  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setAddress(token);
      if (params.get("run")) runAudit(token);
    }
    // Intentionally only on mount / when the query changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const findings = report
    ? [...report.findings].sort(
        (a, b) => (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9)
      )
    : [];

  return (
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
          buy-then-sell round trip against the real pool, if the sell reverts, the token is a
          honeypot, and you found out for free instead of with your money.
        </p>
        <p className="fine">
          Read-only. It never asks for your wallet, never requests an approval, and cannot move
          funds.
        </p>
      </section>

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
            <button className="btn btn-primary" onClick={() => runAudit()} disabled={busy || !address.trim()}>
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
              Load an example
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
                A trap keyed on your address, the block number, or an allowlist can quote clean and
                still fail for you in a real transaction.
              </li>
              <li>
                A blacklist can be applied <em>after</em> you pass a clean audit. An owner who can
                raise the fee can do it the minute you buy.
              </li>
              <li>
                Contract safety is not investment quality. Most launchpad tokens go to zero with
                completely ordinary contracts.
              </li>
            </ul>
          </div>
        </>
      )}
    </>
  );
}
