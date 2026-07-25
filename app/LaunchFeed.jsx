"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The launchpad feed.
 *
 * Every entry is a token the pons factory deployed, read from its own
 * `TokenLaunched` event — so anything launched through this site appears here and
 * on ponsfamily.com alike, because it is the same factory and the same pool.
 */

function fmtUsdish(n, symbol = "Ξ") {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${symbol}${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `${symbol}${n.toFixed(2)}`;
  return `${symbol}${n.toPrecision(3)}`;
}

function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n < 1e-6) return n.toExponential(2);
  return n.toPrecision(4);
}

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

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

function LaunchCard({ launch, rank, explorer, onAudit }) {
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
          <div className="tok-fig">{fmtUsdish(launch.marketCapWeth)}</div>
        </div>
        <div className="tok-fig-right">
          <div className="tok-fig-label">Price</div>
          <div className="tok-fig tok-fig-sm">{fmtPrice(launch.priceInWeth)}</div>
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
        {/* Audit works right now, in this app. */}
        <button className="btn btn-primary tok-btn" onClick={() => onAudit(launch.token)}>
          Audit
        </button>
        {/* Trading is not wired up here yet, so this hands off to pons rather
            than pretending to be a trade button that does nothing. */}
        <a
          className="btn tok-btn"
          href={`https://www.ponsfamily.com/launchpad`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Trade on pons ↗
        </a>
      </div>
    </div>
  );
}

export default function LaunchFeed({ network, onAudit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/launches?network=${encodeURIComponent(network)}&limit=12`);
      const json = await res.json();
      if (!res.ok) setError(json.hint ? `${json.error} ${json.hint}` : json.error);
      else setData(json);
    } catch {
      setError("Could not reach the launch feed.");
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = data?.stats;
  const launches = data?.launches || [];
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
          Launch it here. It trades <em>everywhere</em>.
        </h1>
        <p>
          Tokens deployed through this site use the pons factory, so they appear on
          ponsfamily.com the moment they exist — same factory, same locked WETH pool, same
          chain. Fixed 1,000,000,000 supply, 1% pool fee, liquidity locked in one transaction.
        </p>
      </section>

      {stats && (
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Launches seen</div>
            <div className="stat-value">{stats.scanned}</div>
            <div className="stat-sub">last {stats.windowBlocks.toLocaleString()} blocks</div>
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
            <div className="stat-value">{fmtUsdish(stats.totalMcapWeth)}</div>
            <div className="stat-sub">of the {stats.enriched} shown</div>
          </div>
        </div>
      )}

      {loading && (
        <div className="alert">
          <span className="spinner" />
          <span>Reading TokenLaunched events from the factory…</span>
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

      {!loading && !error && launches.length === 0 && (
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
                onAudit={onAudit}
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
                onAudit={onAudit}
              />
            ))}
          </div>
        </>
      )}

      <p className="form-note" style={{ marginTop: 18 }}>
        Ranked by the order they were deployed, newest first — not by quality. Graduation only
        means the paired-WETH threshold was reached; it is not an audit or an endorsement. Run the
        audit before you buy anything here.
      </p>
    </>
  );
}
