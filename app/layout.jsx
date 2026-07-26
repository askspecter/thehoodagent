import "./globals.css";
import { SessionProvider } from "./session";
import SiteChrome from "./SiteChrome";

export const metadata = {
  metadataBase: new URL("https://www.usecable.trade"),
  title: {
    default: "CABLE — Say it. It trades.",
    template: "%s · CABLE",
  },
  description:
    "Say it. It trades. A natural-language trading terminal, launchpad and token auditor for Robinhood Chain. Type “buy me $5 nvda” — CABLE quotes, checks and fills it. Non-custodial.",
  openGraph: {
    title: "CABLE — Say it. It trades.",
    description:
      "Type “buy me $5 nvda” and CABLE quotes, checks and fills it. Launch tokens, audit contracts, trade by typing — non-custodial, on Robinhood Chain.",
    url: "https://www.usecable.trade",
    siteName: "CABLE",
  },
  twitter: { card: "summary", site: "@usecable" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <SiteChrome />
          <main className="wrap page-main">{children}</main>
          {/* The footer is rendered by the landing page only — it is the main
              page's furniture, not something to repeat on every route. */}
        </SessionProvider>
      </body>
    </html>
  );
}
