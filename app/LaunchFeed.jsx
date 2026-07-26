"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtUsdPrice, fullNumber, shortAddr, usdOr } from "./format";

/**
 * The launchpad feed.
 *
 * Every entry is a token the pons factory deployed, read from its own
 * `TokenLaunched` event, so anything launched through this site appears here and
 * on ponsfamily.com alike, because it is the same factory and the same pool.
 *
 * Figures are shown in dollars with the WETH value underneath. The pool holds
 * WETH and that is the honest denomination, but "Ξ0.00000000284" is not a price
 * anyone can read, and a market cap of "Ξ2.84" tells you nothing about whether
 * this is a two-thousand-dollar token or a two-million-dollar one.
 */

/** Deterministic fallback avatar when a launch has no logo set. */
function TokenLogo({ launch }) {
  const [failed, setFailed] = useState(false);
  const letter = (launch.symbol || launch.name || "?").replace(/^\$/, "").charAt(0).toUpperCase();

  // Only render creator-supplied images over https, and never as a link.
  const src =
    !failed && typeof launch.logo === "string" && /^https:\/\//i.test(launch.logo)
      ? launch.logo
      : null;

  if (src) {
    return (
      <img
        className="tok-logo"
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return <div className="tok-logo tok-logo-fallback">{letter}</div>;
}

function LaunchCard({ launch, rank, explorer, ethUsd, onAudit, onTrade }) {
  const grad = launch.graduated;
  const progress = launch.graduationProgress;

  return (
    <div className="tok">
      <div className="tok-head">
        <TokenLogo launch={launch} />
        <div className="tok-id">
          <div className="tok-sym">
            ${(launch.symbol || "???").replace(/^\$/, "")}
            {grad === true && <span className="tok-badge tok-grad">GRAD</span>}
            {grad === false && <span className="tok-badge tok-curve">TRADING</span>}
          </div>
          <div className="tok-name">{launch.name || "Unnamed launch"}</div>
        </div>
        <div className="tok-rank">#{rank}</div>
      </div>

      <div className="tok-figures">
        <div>
          <div className="tok-fig-label">Market cap</div>
          {/* USD only. The exact WETH figure stays in the tooltip, the small ETH
              line under it read as clutter and confused people. */}
          <div className="tok-fig" title={fullNumber(launch.marketCapWeth, "WETH")}>
            {usdOr(launch.marketCapWeth, ethUsd)}
          </div>
        </div>
        <div className="tok-fig-right">
          <div className="tok-fig-label">Price</div>
          <div className="tok-fig tok-fig-sm" title={fullNumber(launch.priceInWeth, "WETH")}>
            {usdOr(launch.priceInWeth, ethUsd, fmtUsdPrice)}
          </div>
        </div>
      </div>

      {grad === false && progress != null && (
        <div className="tok-prog">
          <div className="tok-prog-head">
            <span>Graduation</span>
            <span className="meter-num">
              {Number(launch.pairedEth).toFixed(3)} / {Number(launch.thresholdEth).toFixed(2)} Ξ
            </span>
          </div>
          <div className="meter-track">
            <div
              className="meter-fill"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
          </div>
        </div>
      )}

      {launch.description && <div className="tok-desc">{launch.description}</div>}

      <div className="tok-foot">
        <span className="tok-meta">
          by {shortAddr(launch.deployer)}
          {launch.creatorSharePercent != null && ` · ${launch.creatorSharePercent}% fees`}
        </span>
        {explorer && (
          <a
            className="tok-link"
            href={`${explorer}/address/${launch.token}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            SCAN ↗
          </a>
        )}
      </div>

      <div className="tok-actions">
        <button className="btn btn-primary tok-btn" onClick={() => onTrade(launch.token)}>
          Trade
        </button>
        <button className="btn tok-btn" onClick={() => onAudit(launch.token)}>
          Audit
        </button>
      </div>
    </div>
  );
}

export default function LaunchFeed({ network, onAudit, onTrade, nonce }) {
  const [data, setData] = useState(null);
  const [ours, setOurs] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  /** "ours" = launched through this site; "all" = everything the factory made. */
  const [scope, setScope] = useState("ours");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [feedRes, ourRes] = await Promise.all([
        fetch(`/api/launches?network=${encodeURIComponent(network)}&limit=12`),
        fetch(`/api/registry?network=${encodeURIComponent(network)}`),
      ]);
      const json = await feedRes.json();
      if (!feedRes.ok) setError(json.hint ? `${json.error} ${json.hint}` : json.error);
      else setData(json);

      if (ourRes.ok) setOurs(await ourRes.json());
    } catch {
      setError("Could not reach the launch feed.");
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    load();
  }, [load, nonce]);

  const stats = data?.stats;
  const allLaunches = data?.launches || [];
  const ourLaunches = ours?.launches || [];

  // "Launched here" is read straight from the registry and enriched on its own,
  // so a token created seconds ago shows up even when it sits past the general
  // feed's bounded window. "All" is the on-chain factory feed.
  const ourCount = ours?.tokens?.length ?? ourLaunches.length;
  const launches = scope === "ours" ? ourLaunches : allLaunches;
  const ethUsd = (scope === "ours" ? ours?.ethUsd : data?.ethUsd) ?? data?.ethUsd ?? null;
  const graduated = launches.filter((l) => l.graduated === true);
  const trading = launches.filter((l) => l.graduated !== true);

  return (
    <>
      <section className="hero hero-tight">
        <div className="eyebrow">
          <span className="live-dot" />
          Launchpad · pons factory
        </div>
        <h1>
          Create it here. It trades <em>everywhere</em>.
          <span className="cursor" />
        </h1>
        <p>
          Tokens deployed through this site use the pons factory, so they appear on
          ponsfamily.com the moment they exist, same factory, same locked WETH pool, same
          chain. Fixed 1,000,000,000 supply, 1% pool fee, liquidity locked in one transaction.
        </p>
      </section>

      {stats && (
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Launches seen</div>
            <div className="stat-value">{stats.scanned}</div>
            <div className="stat-sub">last {stats.windowBlocks.toLocaleString("en-US")} blocks</div>
          </div>
          <div className="stat">
            <div className="stat-label">Graduated</div>
            <div className="stat-value">{stats.graduated}</div>
            <div className="stat-sub">threshold reached</div>
          </div>
          <div className="stat">
            <div className="stat-label">Pre-graduation</div>
            <div className="stat-value">{stats.trading}</div>
            <div className="stat-sub">still filling the pool</div>
          </div>
          <div className="stat">
            <div className="stat-label">Combined mcap</div>
            <div className="stat-value" title={fullNumber(stats.totalMcapWeth, "WETH")}>
              {usdOr(stats.totalMcapWeth, ethUsd)}
            </div>
            <div className="stat-sub">of the {stats.enriched} shown</div>
          </div>
        </div>
      )}

      <div className="side-toggle">
        {[
          ["ours", `Launched here${ourCount ? ` · ${ourCount}` : ""}`],
          ["all", "All pons launches"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`nav-tab ${scope === key ? "nav-on" : ""}`}
            onClick={() => setScope(key)}
          >
            {label}
          </button>
        ))}
        <span className="nav-spacer" />
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          ↻ Refresh
        </button>
      </div>

      {loading && (
        <div className="alert">
          <span className="spinner" />
          <span>Reading TokenLaunched events from the factory…</span>
        </div>
      )}

      {!loading && scope === "ours" && launches.length === 0 && (
        <div className="alert">
          <span className="alert-icon">·</span>
          <span>
            <strong>Nothing launched here yet.</strong> Use the <b>Create</b> tab to deploy the
            first one, it will appear here and on ponsfamily.com at the same time. Or switch to{" "}
            <button className="link-btn" onClick={() => setScope("all")}>
              all pons launches
            </button>{" "}
            to browse everything the factory has made.
          </span>
        </div>
      )}

      {ours?.warning && scope === "ours" && (
        <div className="alert alert-warn">
          <span className="alert-icon">▲</span>
          <span>{ours.warning}</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">✖</span>
          <span>{error}</span>
        </div>
      )}

      {data?.note && (
        <div className="alert alert-warn">
          <span className="alert-icon">▲</span>
          <span>{data.note}</span>
        </div>
      )}

      {!loading && !error && scope === "all" && launches.length === 0 && (
        <div className="alert">
          <span className="alert-icon">·</span>
          <span>
            No launches found in the scanned block window. Widen it with{" "}
            <code>LAUNCH_SCAN_BLOCKS</code>, or the window may simply predate recent activity.
          </span>
        </div>
      )}

      {graduated.length > 0 && (
        <>
          <div className="section-title">Graduated · {graduated.length}</div>
          <div className="toks">
            {graduated.map((l, i) => (
              <LaunchCard
                key={l.token}
                launch={l}
                rank={i + 1}
                explorer={data.explorer}
                ethUsd={ethUsd}
                onAudit={onAudit}
                onTrade={onTrade}
              />
            ))}
          </div>
        </>
      )}

      {trading.length > 0 && (
        <>
          <div className="section-title">Pre-graduation · {trading.length}</div>
          <div className="toks">
            {trading.map((l, i) => (
              <LaunchCard
                key={l.token}
                launch={l}
                rank={graduated.length + i + 1}
                explorer={data.explorer}
                ethUsd={ethUsd}
                onAudit={onAudit}
                onTrade={onTrade}
              />
            ))}
          </div>
        </>
      )}

      <p className="form-note" style={{ marginTop: 18 }}>
        Ranked by the order they were deployed, newest first, not by quality. Graduation only
        means the paired-WETH threshold was reached; it is not an audit or an endorsement. Run the
        audit before you buy anything here.
      </p>
    </>
  );
}
