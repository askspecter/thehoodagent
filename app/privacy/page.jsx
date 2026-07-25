export const metadata = {
  title: "Privacy Policy",
  description: "What CABLE collects, what it does not, and why.",
};

const UPDATED = "July 2026";

export default function PrivacyPage() {
  return (
    <article className="legal">
      <div className="eyebrow">
        <span className="live-dot" />
        Legal
      </div>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>

      <p>
        CABLE is a non-custodial interface to Robinhood Chain and the pons launchpad. It is built to
        need as little of your data as possible. This policy explains the little it does touch.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Your X identity, if you sign in.</strong> When you sign in with X we read and keep
          your X user id, handle, display name and avatar URL — nothing more. We use them to show
          who is signed in and to derive your wallet.
        </li>
        <li>
          <strong>Nothing that can move your funds.</strong> The OAuth access token X returns is
          used once to read that profile and is then discarded. CABLE never posts on your behalf and
          never keeps a token that could.
        </li>
        <li>
          <strong>Token logos you upload.</strong> If you create a token and upload a logo, the
          image is stored so the token can display it. Do not upload anything you would not publish.
        </li>
      </ul>

      <h2>What we do not store</h2>
      <ul>
        <li>
          <strong>Private keys.</strong> The wallet tied to your X account is <em>derived</em> from
          a server secret and your X id on demand — it is never written to a database. Browser
          wallets sign in your browser and never send their keys to us.
        </li>
        <li>
          <strong>Your trades or balances.</strong> These live on the public chain, not with us. We
          read them live to show you; we do not keep a record.
        </li>
        <li>
          <strong>Trackers and ad profiles.</strong> No advertising, no cross-site tracking, no sale
          of data.
        </li>
      </ul>

      <h2>What is handled briefly</h2>
      <ul>
        <li>
          <strong>Operational data.</strong> Like any website, requests reach a server and may be
          logged transiently for reliability and abuse prevention. The audit endpoint uses your IP
          only to rate-limit, held in memory.
        </li>
        <li>
          <strong>On-chain reads.</strong> To price tokens and read balances, the server queries a
          Robinhood Chain RPC and public price APIs. Those third parties see the requests the server
          makes, not your identity.
        </li>
      </ul>

      <h2>Your control</h2>
      <p>
        Sign out at any time to clear your session cookie. Because your wallet is derived rather than
        stored, there is no account record to delete — signing out simply forgets who you are until
        you sign in again. You can export your wallet’s private key from the Profile page to take it
        fully into your own custody.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy can go to{" "}
        <a href="https://x.com/usecable" target="_blank" rel="noopener noreferrer">
          @usecable
        </a>{" "}
        on X.
      </p>
    </article>
  );
}
