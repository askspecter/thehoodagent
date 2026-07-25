"use client";

import Link from "next/link";
import { useSession } from "./session";
import { XLogo } from "./constants";

/**
 * The landing page.
 *
 * Explains what CABLE is and sends you into the app. Every section links to a
 * real route, so a visitor can go straight to the terminal, the launchpad or the
 * auditor from here.
 */

const PILLARS = [
  {
    tag: "Terminal",
    href: "/terminal",
    title: "Trade by typing",
    body: "“buy me $5 pons” is a complete instruction. CABLE resolves the ticker against the live feed, converts the dollars at the current ETH rate, quotes the fill through the real pool, and hands you a plan to confirm. Nothing is sent from a typed line alone.",
    cta: "Open the terminal",
  },
  {
    tag: "Launchpad",
    href: "/create",
    title: "Create a token",
    body: "One transaction mints a fixed 1,000,000,000 supply and opens a locked WETH pool at a 1% fee. It goes through the pons factory, so it appears on ponsfamily.com the moment it exists — same factory, same pool, same chain.",
    cta: "Create a token",
  },
  {
    tag: "Auditor",
    href: "/audit",
    title: "Check before you buy",
    body: "Paste an address and CABLE simulates a full buy-then-sell round trip against the real pool. If the sell reverts, the token is a honeypot — and you found out for free instead of with your money. Read-only, no wallet needed.",
    cta: "Run an audit",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Sign in with X, or connect a wallet",
    body: "Signing in with X mints a wallet from your account — no seed phrase. Or connect a browser wallet. Either one signs your trades; CABLE never holds your keys or your funds.",
  },
  {
    n: "02",
    title: "Say what you want",
    body: "Type a command in plain language, browse the launch feed, or fill in the create form. Every price and market cap is shown in dollars, read live off the chain.",
  },
  {
    n: "03",
    title: "Confirm — with the worst case in front of you",
    body: "Trades are quoted and simulated first, so a bad one costs nothing. You confirm a plan that spells out what you pay, what you receive, and the floor at your slippage.",
  },
];

const COMMANDS = [
  ["buy me $5 pons", "five dollars of $PONS, converted for you"],
  ["sell all pons", "reads your balance, quotes the exit"],
  ["price pons", "live pool price and market cap"],
  ["audit 0x…", "full honeypot and owner-power scan"],
  ["create HOOD Hood Rat", "opens the form, prefilled"],
  ["portfolio", "every launch you hold, priced"],
];

export default function Landing() {
  const { user, signIn } = useSession();

  return (
    <>
      <section className="lp-hero">
        <div className="eyebrow">
          <span className="live-dot" />
          Robinhood Chain · chain id 4663
        </div>
        <h1 className="lp-title">
          Say it. <em>It trades.</em>
          <span className="cursor" />
        </h1>
        <p className="lp-lede">
          CABLE is a trading terminal, launchpad and token auditor for Robinhood Chain — driven by
          plain language. Type a command, launch a token, or check one before you buy. Your wallet
          signs everything; CABLE never custodies a cent.
        </p>
        <div className="lp-cta">
          <Link className="btn btn-primary" href="/terminal">
            Open the terminal
          </Link>
          <Link className="btn" href="/audit">
            Audit a token
          </Link>
          {!user && (
            <button className="btn btn-x" onClick={signIn}>
              <XLogo /> Sign in with X
            </button>
          )}
        </div>
      </section>

      <div className="lp-pillars">
        {PILLARS.map((p) => (
          <Link className="lp-pillar" href={p.href} key={p.tag}>
            <div className="lp-pillar-tag">{p.tag}</div>
            <div className="lp-pillar-title">{p.title}</div>
            <p className="lp-pillar-body">{p.body}</p>
            <span className="lp-pillar-cta">{p.cta} →</span>
          </Link>
        ))}
      </div>

      <div className="section-title">The command line</div>
      <div className="lp-commands">
        {COMMANDS.map(([cmd, what]) => (
          <Link className="lp-cmd" href="/terminal" key={cmd}>
            <span className="lp-cmd-line">
              <span className="lp-cmd-prompt">▸</span> {cmd}
            </span>
            <span className="lp-cmd-what">{what}</span>
          </Link>
        ))}
      </div>

      <div className="section-title">How it works</div>
      <div className="steps">
        {STEPS.map((s) => (
          <div className="step" key={s.n}>
            <div className="step-num">{s.n}</div>
            <div className="step-title">{s.title}</div>
            <div className="step-body">{s.body}</div>
          </div>
        ))}
      </div>

      <div className="section-title">The honest part</div>
      <div className="panel">
        <ul className="limits">
          <li>
            <strong>Non-custodial.</strong> Every transaction is signed in your own wallet — your
            browser wallet, or the one your X account mints. No private key reaches the server.
          </li>
          <li>
            <strong>Priced live.</strong> Prices and market caps are read straight off the pool and
            shown in dollars. If the rate can’t be fetched, CABLE shows WETH rather than inventing a
            number.
          </li>
          <li>
            <strong>An audit is a scan, not a promise.</strong> A clean result means no trap was
            visible right now. Owners who can raise a fee or apply a blacklist can trap you after a
            clean check. Most launchpad tokens go to zero regardless.
          </li>
        </ul>
      </div>

      <div className="lp-foot-cta">
        <h2>Ready?</h2>
        <div className="lp-cta">
          <Link className="btn btn-primary" href="/terminal">
            Open the terminal
          </Link>
          <Link className="btn" href="/launches">
            Browse launches
          </Link>
        </div>
      </div>
    </>
  );
}
