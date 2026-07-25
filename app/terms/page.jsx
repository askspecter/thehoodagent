export const metadata = {
  title: "Terms of Use",
  description: "The terms you agree to by using CABLE.",
};

const UPDATED = "July 2026";

export default function TermsPage() {
  return (
    <article className="legal">
      <div className="eyebrow">
        <span className="live-dot" />
        Legal
      </div>
      <h1>Terms of Use</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>

      <p>
        By using CABLE you agree to these terms. CABLE is an interface to public smart contracts on
        Robinhood Chain. It is not a broker, an exchange, a custodian, or a financial adviser.
      </p>

      <h2>Non-custodial by design</h2>
      <p>
        Every transaction is submitted and signed through your own wallet, a browser wallet you
        connect, or the wallet derived from your X account. CABLE cannot move, freeze, or recover
        your funds. On-chain transactions are typically irreversible; once you confirm one, it is
        out of anyone’s hands.
      </p>

      <h2>No financial advice</h2>
      <p>
        Nothing on CABLE is investment, financial, legal or tax advice. Prices, market caps,
        audits, scores and any other figures are informational and may be wrong, stale, or
        incomplete. An audit is an automated heuristic scan of what is visible on-chain at the
        moment of the check, never a guarantee of safety. A token that passes a clean audit can
        still be trapped afterward by an owner who can raise a fee or apply a blacklist, and most
        launchpad tokens go to zero regardless of whether their contract is technically sound.
      </p>

      <h2>Your responsibility</h2>
      <ul>
        <li>You are responsible for verifying every contract address and every transaction before you sign it.</li>
        <li>You are responsible for the security of your wallet and, if you export it, your private key.</li>
        <li>You are responsible for your own compliance with the laws and taxes that apply to you.</li>
        <li>You must be legally permitted to use a service like this where you live.</li>
      </ul>

      <h2>No affiliation</h2>
      <p>
        CABLE is an independent interface. It is not affiliated with, endorsed by, or operated by
        Robinhood, pons, or any token creator. Names and marks belong to their owners. Verify domains
        manually, lookalike launchpad sites are a common way wallets get drained.
      </p>

      <h2>As-is, and limitation of liability</h2>
      <p>
        CABLE is provided “as is” and “as available”, without warranties of any kind. To the fullest
        extent permitted by law, the operators of CABLE are not liable for any loss, including lost
        funds, failed or reverted transactions, honeypots, smart-contract bugs, RPC or price-feed
        errors, or downtime, arising from your use of the interface. You use it at your own risk.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change as the product changes. Continuing to use CABLE after an update means
        you accept the revised terms.
      </p>

      <h2>Contact</h2>
      <p>
        Reach us at{" "}
        <a href="https://x.com/usecable" target="_blank" rel="noopener noreferrer">
          @usecable
        </a>{" "}
        on X.
      </p>
    </article>
  );
}
