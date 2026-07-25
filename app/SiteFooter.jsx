"use client";

import Link from "next/link";
import { XLogo } from "./constants";

/**
 * The site footer, on every page.
 *
 * One X link, at the very bottom, to @usecable. The legal pages are reachable
 * from here and nowhere noisier.
 */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="foot-lede">
        <div className="foot-brand">
          <img className="foot-logo" src="/cable.png" alt="" />
          CABLE
        </div>
        <p>
          Launch, trade and audit fixed-supply tokens on Robinhood Chain — by typing a command.
          Your wallet submits every transaction. CABLE never custodies assets.
        </p>
      </div>

      <div className="foot-cols">
        <div className="foot-col">
          <div className="foot-head">Product</div>
          <Link href="/terminal">Terminal</Link>
          <Link href="/launches">Launches</Link>
          <Link href="/create">Create</Link>
          <Link href="/audit">Audit</Link>
        </div>
        <div className="foot-col">
          <div className="foot-head">Legal</div>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Use</Link>
        </div>
        <div className="foot-col">
          <div className="foot-head">Chain</div>
          <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noopener noreferrer">
            Explorer ↗
          </a>
          <a href="https://ponsfamily.com" target="_blank" rel="noopener noreferrer">
            pons ↗
          </a>
        </div>
      </div>

      <div className="foot-risk">
        <div className="foot-head">Risk notice</div>
        <p>
          Transactions are submitted through your own wallet and may be irreversible. Tokens can be
          volatile or lose all value. An audit is an automated heuristic scan, not a guarantee.
          CABLE provides no custody, no warranties, and no financial advice, and is not affiliated
          with Robinhood or pons.
        </p>
      </div>

      <div className="foot-base">
        <span>© {new Date().getFullYear()} CABLE</span>
        <a
          className="foot-x"
          href="https://x.com/usecable"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="CABLE on X — @usecable"
        >
          <XLogo /> @usecable
        </a>
      </div>
    </footer>
  );
}
