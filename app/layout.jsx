import "./globals.css";

export const metadata = {
  title: "CABLE — launch, trade, audit on Robinhood Chain",
  description:
    "A trading terminal, launchpad and token auditor for Robinhood Chain. Type a command, or paste an address to check it before you buy.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
