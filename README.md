# Pons Sentinel

**Find out if you can sell a token — before you buy it.**

A token auditor for [Robinhood Chain](https://docs.robinhood.com/chain/) and the
Pons Launchpad. Sign in with X, paste a contract address, and get a risk report
built from what the chain actually says — including a simulated buy-and-sell
round trip that detects honeypots without spending anything.

<!-- Screenshot: run the app and see for yourself — instructions below. -->

---

## What is in here

| Path | What it is |
|---|---|
| **`web/`** | **The web app.** Next.js, X (Twitter) sign-in, audit dashboard. [Setup →](web/README.md) |
| **`agent/`** | The audit engine (`@pons/engine`). Plain Node, read-only, shared by the web app. |
| `agent/cli.js` | Optional terminal wrapper around the same engine, handy while developing. |
| `contracts/PonsFamilyToken.sol` | A fixed-supply ERC-20, if you ever deploy a token *independently* of Pons. |
| `contracts/mocks/MaliciousToken.sol` | Test fixture full of rug patterns — target practice that proves the scanner fires. |
| `test/` | 22 tests. Runs the engine against real bytecode on an in-process EVM. |

```bash
npm install          # root: contracts + engine + tests
npm test             # 22 passing
cd web && npm install && npm run dev
```

---

## The audit

| Check | How it works |
|---|---|
| **Honeypot** | Quotes a buy *and* a sell through the real Uniswap V3 pool using QuoterV2 via `eth_call`. The quote executes the token's own transfer hook, so a sell block shows up as a reverting sell quote. Nothing is spent and no approval is granted. |
| **Sell tax** | Round-trip loss. ~2–4% is normal fees; 20%+ implies a transfer tax; 50%+ is a soft honeypot. |
| **Owner power** | Reads PUSH4 selectors out of the deployed dispatcher to find `mint`, `blacklist`, `pause`, `setFee`, `setMaxTxAmount`, … — so it works on unverified contracts, which is most of a launchpad. |
| **Ownership** | `owner()` renounced counts in the token's favour; a live owner *plus* privileged functions is the worst case. |
| **Upgradeable proxy** | EIP-1967 / OZ-legacy implementation slots. Upgradeable logic can gain a sell block after you buy. |
| **Concentration** | Replays `Transfer` events and ranks holders. A DEX pool legitimately holds a large share, so this is flagged for review rather than called malice. |

The bytecode walker respects PUSH immediates rather than substring-matching, so
PUSH *data* that happens to contain a selector's bytes does not produce a false
accusation. There is a test for exactly that.

### What it cannot tell you

- A trap keyed on `tx.origin`, block height, or a per-wallet allowlist can quote
  clean and still fail for you.
- A blacklist can be applied **after** a clean audit.
- Contract safety is not investment quality. Most launchpad tokens go to zero
  with completely ordinary contracts.

A report always states which checks did **not** run; a skipped safety check drops
the report's confidence to `partial` rather than reading as a pass.

---

## Try it with no money and no live network

```bash
npx hardhat node                                           # terminal 1
npx hardhat run scripts/seed-local.js --network localhost  # terminal 2
```

Pick **Local EVM** in the app and paste a printed address:

| Fixture | Result |
|---|---|
| `MaliciousToken` — "Rug Pull Inu" | **AVOID, 100/100** — mint, blacklist, pause, live owner, 70% concentration, fee control |
| `PonsFamilyToken` — "$PONS" | Low score — no owner, no privileged functions |

---

## About launching a token on Pons

Two different paths, often confused:

**Using the Pons Launchpad** (<https://www.ponsfamily.com/>) needs **no code at
all**. It is a web form: connect wallet, fill in name/ticker/image, pay the
creation fee. Reported mechanics: supply is a fixed **1,000,000,000** chosen by
the platform, the token goes straight into a **Uniswap V3 pool paired with
WETH**, liquidity is locked automatically, and the creator earns **70% of the 1%
trading fee**. You do **not** supply the ETH side of liquidity — buyers do.

**Deploying independently** is what `contracts/PonsFamilyToken.sol` is for. There
you choose the supply, and you *do* fund the paired asset yourself — that capital
is what gives the token a price. After creating the pool, lock or burn the LP
tokens; withdrawable LP is the biggest trust problem a new token has.

> The Pons figures above come from third-party reporting, not from reading the
> official docs directly. **Verify at <https://docs.ponsfamily.com/> before
> paying anything.**

### "Can I build the stonkbrokers system this way?"

No — not through a launchpad. Pons produces a plain fungible token in a Uniswap
pool. The stonkbrokers model is a separate custom-contract build layered *on top*
of a token: an NFT collection where each NFT owns a real wallet (ERC-6551) seeded
with tokens at mint, an AMM for the NFTs, and a distributor that pays trading
fees to NFT holders as dividends. Robinhood Chain allows permissionless
deployment (chain ID **4663**), so it is possible — but it is a serious contract
project that needs an audit, and it only pays off once a token has real trading
volume behind it.

---

## ⚠️ Verify the Pons contract addresses

`agent/lib/chains.js` ships the Pons factory / router / quoter / WETH addresses
transcribed from third-party reporting. **Check each against the official docs and
the block explorer, then override them via `.env`.** A wrong or lookalike router
address is a classic way wallets get drained — and `ponfamily.com` (no "s") is not
the real site. Type domains manually.

Pons is not affiliated with Robinhood.

---

## Security

- The engine is **read-only**: nothing here signs a transaction, holds a private
  key, or spends funds. Trading and launching happen in the user's own wallet.
- `PRIVATE_KEY` in the root `.env` is only for *deploying your own contract*. Use
  a fresh wallet with only the gas it needs. Never paste a key into a chat, a
  website, or a "support" DM.
- `SESSION_SECRET` signs login cookies. Rotating it invalidates all sessions.

## License

MIT
