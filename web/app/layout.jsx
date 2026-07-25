import "./globals.css";

export const metadata = {
  title: "Pons Sentinel — token audit for Robinhood Chain",
  description:
    "Simulate buying and selling a Pons Launchpad token before you spend anything. Honeypot detection, owner-power scan, and holder concentration.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
