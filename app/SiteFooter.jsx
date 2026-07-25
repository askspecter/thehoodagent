"use client";

import Link from "next/link";
import { XLogo } from "./constants";

/**
 * A deliberately minimal footer.
 *
 * The navigation destinations already live in the ⋮ menu, so the only links here
 * are the two legal pages, which live nowhere else — plus the single X link to
 * @usecable at the very bottom. Same hairline-and-mono treatment as the rest.
 */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell foot-inner">
        <nav className="foot-legal">
          <Link href="/privacy">Privacy Policy</Link>
          <span className="foot-sep" aria-hidden="true">
            ·
          </span>
          <Link href="/terms">Terms of Use</Link>
        </nav>

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

      <div className="shell foot-base">
        <span>© {new Date().getFullYear()} CABLE</span>
        <span className="foot-note">
          Non-custodial · not financial advice · not affiliated with Robinhood or pons
        </span>
      </div>
    </footer>
  );
}
