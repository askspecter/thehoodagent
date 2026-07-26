import Link from "next/link";
import SiteFooter from "../SiteFooter";

/**
 * The Utility page.
 *
 * What $CABLE is for. The core loop is buyback-and-burn from platform fees; the
 * rest is hold-to-use, built on the terminal, auditor and launchpad that already
 * exist. Every card is honest about what is live and what is still coming — the
 * one thing that has actually happened (the 10M burn) is stated plainly, and
 * nothing here promises a price.
 */

export const metadata = {
  title: "Utility",
  description:
    "$CABLE utility: platform fees buy back and burn the token, and holding it unlocks lower fees, higher limits, featured launches, revenue share and governance.",
};

/** The five hold-to-use utilities, each labelled by rollout phase. */
const UTILITIES = [
  {
    title: "Fee discount",
    phase: "Phase 2",
    body: "Pay platform fees in $CABLE, or hold enough, and the fee drops. The more the terminal is used, the more it pays to hold the token that runs it.",
  },
  {
    title: "Higher limits",
    phase: "Phase 2",
    body: "Holding $CABLE lifts your ceilings: higher terminal and audit rate limits, deeper audits — wider block scans and holder-concentration analysis — and pro portfolio views and alerts.",
  },
  {
    title: "Featured launches",
    phase: "Phase 2",
    body: "Pin a launch to the top of the launchpad, the same Official-style highlight, by holding or burning a little $CABLE. Attention is the scarcest thing on a launchpad; this is how you earn it, on-chain.",
  },
  {
    title: "Revenue share",
    phase: "Phase 3",
    body: "Stake $CABLE to earn a share of real platform fees — yield from usage, not from emissions. Rolled out only where it is compliant to offer.",
  },
  {
    title: "Governance",
    phase: "Phase 3",
    body: "Holders steer what gets featured, where fee parameters land, and which chain CABLE opens next. The people using the terminal decide where it goes.",
  },
];

const PHASES = [
  {
    n: "01",
    title: "Buyback & burn",
    body: "A slice of every fee CABLE earns routes to a treasury that market-buys $CABLE and burns it. Usage becomes steady, visible pressure on supply. Started already — 10,000,000 $CABLE burned — and every buyback transaction is posted on-chain.",
  },
  {
    n: "02",
    title: "Hold to use",
    body: "Fee discounts, higher terminal and audit limits, and featured launches unlock for holders. The token that runs the terminal becomes the token that makes it cheaper and stronger to use.",
  },
  {
    n: "03",
    title: "Share & steer",
    body: "Staking for a share of real platform fees, and holder governance over what gets featured, fee parameters, and the next chain CABLE opens.",
  },
];

export default function UtilityPage() {
  return (
    <>
      <section className="hero hero-tight">
        <div className="eyebrow">
          <span className="live-dot" />
          Tokenomics · $CABLE utility
        </div>
        <h1>
          Fees in. <em>Supply down.</em>
          <span className="cursor" />
        </h1>
        <p>
          $CABLE is the token that runs CABLE, and it earns its keep. Fees from launches and trades
          routed through the terminal buy the token back and burn it, and holding it unlocks the
          product itself — lower fees, higher limits, featured launches, and a say in what comes
          next. Utility ships in phases; what has already happened is stated plainly below.
        </p>
      </section>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Total supply</div>
          <div className="stat-value">1,000,000,000</div>
          <div className="stat-sub">fixed at launch</div>
        </div>
        <div className="stat">
          <div className="stat-label">Burned so far</div>
          <div className="stat-value">10,000,000</div>
          <div className="stat-sub">1% of supply · on-chain</div>
        </div>
        <div className="stat">
          <div className="stat-label">Buyback source</div>
          <div className="stat-value stat-min">Platform fees</div>
          <div className="stat-sub">launches + trades</div>
        </div>
        <div className="stat">
          <div className="stat-label">Custody</div>
          <div className="stat-value stat-min">Non-custodial</div>
          <div className="stat-sub">you sign everything</div>
        </div>
      </div>

      <div className="section-title">The core loop</div>
      <div className="panel">
        <ul className="limits">
          <li>
            <strong>Buyback &amp; burn.</strong> A slice of every fee CABLE earns — from launches and
            trades routed through the terminal — flows to a treasury that market-buys $CABLE and
            burns it. Growth in usage becomes steady, visible pressure on supply.
          </li>
          <li>
            <strong>Proven on-chain, not promised.</strong> The treasury wallet and every buyback
            transaction are posted on-chain for anyone to verify. First move already made:{" "}
            <strong>10,000,000 $CABLE burned.</strong>
          </li>
          <li>
            <strong>Usage is the engine.</strong> No emissions, no inflation to fund it. The token
            gets scarcer the more the terminal, launchpad and auditor are actually used.
          </li>
        </ul>
      </div>

      <div className="section-title">What holding $CABLE gets you</div>
      <div className="caps">
        {UTILITIES.map((u) => (
          <div className="cap" key={u.title}>
            <div className="cap-head">
              <div className="cap-title">{u.title}</div>
              <div className="cap-status cap-planned">{u.phase}</div>
            </div>
            <div className="cap-body">{u.body}</div>
          </div>
        ))}
      </div>

      <div className="section-title">Rollout</div>
      <div className="steps">
        {PHASES.map((p) => (
          <div className="step" key={p.n}>
            <div className="step-num">{p.n}</div>
            <div className="step-title">{p.title}</div>
            <div className="step-body">{p.body}</div>
          </div>
        ))}
      </div>

      <div className="lp-foot-cta">
        <h2>Say it. It trades.</h2>
        <p className="form-note" style={{ maxWidth: "60ch", margin: "6px auto 18px" }}>
          The utility is built on a product that already works. Open the terminal, launch a token, or
          audit one before you buy.
        </p>
        <div className="lp-cta">
          <Link className="btn btn-primary" href="/terminal">
            Open the terminal
          </Link>
          <Link className="btn" href="/launches">
            See the launches
          </Link>
        </div>
      </div>

      <p className="form-note" style={{ marginTop: 22 }}>
        Utility ships in phases, and some features roll out only where they are compliant to offer.
        Nothing here is a promise of profit or financial advice. $CABLE is a utility token for using
        CABLE, not an investment contract. Timelines and mechanics may change as the product grows.
      </p>

      <SiteFooter />
    </>
  );
}
