import "./globals.css";
import { SessionProvider } from "./session";
import SiteChrome from "./SiteChrome";

export const metadata = {
  metadataBase: new URL("https://www.usecable.trade"),
  title: {
    default: "CABLE — launch, trade and audit on Robinhood Chain",
    template: "%s · CABLE",
  },
  description:
    "A trading terminal, launchpad and token auditor for Robinhood Chain. Type a command like “buy me $5 nvda”, or paste an address to check it before you buy.",
  openGraph: {
    title: "CABLE",
    description: "Launch, trade and audit fixed-supply tokens on Robinhood Chain — by typing a command.",
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
