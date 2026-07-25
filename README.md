# pons sentinel

**Find out if you can sell a token — before you buy it.**

A token auditor for [Robinhood Chain](https://docs.robinhood.com/chain/) and the
[pons launchpad](https://www.ponsfamily.com/). Sign in with X, paste a contract
address, and get a risk report built from what the chain actually says — including
a simulated buy-and-sell round trip that detects honeypots without spending
anything.

The Next.js app is at the **repository root**, so Vercel deploys it with no
configuration at all.

```bash
npm install
cp .env.example .env.local     # then fill in SESSION_SECRET
npm run dev                    # http://localhost:3000
```

---

## How the agent runs

The agent lives **inside the website**. There is no command-line tool and nothing
for a visitor to install — they open the site, sign in with X, and the agent works
in the page.

```
Browser (the visitor)
   │  signs in with X, types a token address
   ▼
Next.js page  app/page.jsx
   │  POST /api/audit
   ▼
API route  app/api/audit/route.js       ← the agent runs HERE, server-side
   │  imports lib/engine
   ▼
Robinhood Chain RPC (read-only eth_call / eth_getCode / eth_getLogs)
```

The engine runs on the server rather than in the browser on purpose: it keeps the
RPC endpoint and any API keys out of client code, and one warm connection serves
every visitor.

**When trading and launching are added, the split changes in one specific way:**
reading stays on the server, but *signing* happens in the visitor's own wallet in
their browser. A private key never reaches the server. That is not a limitation —
it is the only correct design.

---

## Layout

| Path | What it is |
|---|---|
| `app/` | The website. Pages and API routes. |
| `lib/engine/` | The audit engine. Read-only; runs server-side. |
| `lib/session.js` | HMAC-signed cookie sessions for X sign-in. |
| `contracts/PonsFamilyToken.sol` | A fixed-supply ERC-20, if you deploy a token *independently* of pons. |
| `contracts/mocks/MaliciousToken.sol` | Test fixture full of rug patterns — target practice proving the scanner fires. |
| `test/` | 28 tests. Runs the engine against real bytecode on an in-process EVM. |

Hardhat and Next.js share one `package.json`. `npm test` runs the contract and
engine tests; `npm run build` builds the site. They do not interfere.

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
| **pons launch state** | Reads the deploying factory's `getLaunchedToken` and `graduationStatus`, the token's own `liquidityPool()`/`socials()`, and the locker's fee split. Gives the exact pool and fee tier (no tier guessing), graduation progress, the creator payout wallet, and whether launch protection is still active. |
| **Impersonation** | If neither the active nor the legacy pons factory has a record of the token, that is reported — names, symbols and images can be copied, so only the address is identity. |

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
npx hardhat node        # terminal 1
npm run seed:local      # terminal 2
```

Then in the website pick **Local EVM** and paste a printed address:

| Fixture | Result |
|---|---|
| `MaliciousToken` — "Rug Pull Inu" | **AVOID, 100/100** — mint, blacklist, pause, live owner, 70% concentration, fee control |
| `PonsFamilyToken` — "$PONS" | Low score — no owner, no privileged functions |

---

## Deploying to Vercel

The app is at the repository root and `vercel.json` pins
`"framework": "nextjs"`, so **no project settings need changing** — that file
overrides the dashboard's framework preset.

> **If you previously set Root Directory to `web`, clear it.** That directory no
> longer exists; the app moved to the root. Leave Root Directory empty.

### Why `vercel.json` is needed

The project was created when the repository root held only the Hardhat project, so
Vercel could not detect a framework and locked the preset to **Other**. With that
preset Vercel never invokes its Next.js builder: it runs the build, ignores
`.next`, looks for a static `public/` directory, and fails with

```
Error: No Output Directory named "public" found after the Build completed.
```

— immediately *after* Next.js reported `✓ Compiled successfully` and listed every
route. A perfect build followed by that error means the framework preset is wrong,
not the code. `vercel.json` fixes it in the repository so the setting cannot drift
again. (The dashboard equivalent is Settings → Build and Deployment → Framework
Preset → **Next.js**.)

### Environment variables are optional to get started

**Audits work with no environment variables at all.** The auditor is read-only, so
gating it behind sign-in would only fail the person who most needs it — someone
about to buy a token they have not checked. Anonymous visitors get 5 audits per
minute (throttled by IP); signing in with X raises that to 15.

If `X_CLIENT_ID` / `X_REDIRECT_URI` are absent, the sign-in button simply does not
render — no "not configured" notice, because that reads as a broken site to a
visitor. Set them when you want sign-in.

Variables (Settings → Environment Variables):

| Variable | Value |
|---|---|
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `X_CLIENT_ID` | from your X app |
| `X_CLIENT_SECRET` | from your X app |
| `X_REDIRECT_URI` | `https://<your-domain>/api/auth/x/callback` |
| `ROBINHOOD_RPC` | optional; a private RPC avoids public rate limits |
| `AUDIT_MAX_BLOCKS` | optional; lower it if audits time out |

### Debugging a Vercel 404

A `404: NOT_FOUND` with an error ID is a **platform** 404 — nothing is serving
that URL. A dark "This page could not be found" is Next.js, meaning the app *is*
running and only the route is missing. They are different problems.

Note that **"Ready" does not mean "there is a website"** — it means the build
finished without erroring. A build that produces no output is still Ready. If you
see Ready plus a platform 404, the build produced nothing, which is what happens
when Vercel builds a directory that has no Next.js app in it.

### Serverless caveats

- **Holder concentration replays `Transfer` logs**, which can be slow. The pons
  docs warn that the public RPC times out on wide `eth_getLogs` ranges — the
  engine chunks requests and degrades to a partial result rather than failing, but
  on Vercel's default function timeout you may need to lower `AUDIT_MAX_BLOCKS`.
- **Rate limiting is in-memory**, so it resets on cold starts and does not span
  instances. Move it to Redis before real traffic.

---

## X (Twitter) sign-in setup

1. Create an app at <https://developer.x.com>.
2. Open **User authentication settings**.
3. Enable **OAuth 2.0**, App type **Web App** (a confidential client — this is
   what gives you a client secret).
4. Add both callback URLs:
   - `http://localhost:3000/api/auth/x/callback`
   - `https://<your-domain>/api/auth/x/callback`
5. Scopes: `users.read`, `tweet.read`.

`X_REDIRECT_URI` must match what X has registered **exactly**, including scheme
and path. A mismatch is the most common cause of `token_exchange_failed`.

The app stores only your X id, handle, display name and avatar, and deliberately
**discards the access token** after reading your profile — it never posts on your
behalf, so keeping the token would be a liability with no benefit.

---

## Launching a token on pons

Two different paths, often confused:

**Using the pons launchpad** needs **no code at all**. It is a web form: connect
wallet, fill in name/ticker/image, pay the fee. Per the docs: supply is a fixed
**1,000,000,000**, the token goes straight into a **Uniswap V3 pool paired with
WETH** at a **1% pool fee**, liquidity is locked automatically, the launch fee is
**0.0005 ETH**, and the creator earns **70%** of trading fees (90% on the legacy
factory). You do **not** supply the ETH side of liquidity — buyers do.

**Deploying independently** is what `contracts/PonsFamilyToken.sol` is for. There
you choose the supply, and you *do* fund the paired asset yourself — that capital
is what gives the token a price. After creating the pool, lock or burn the LP
tokens; withdrawable LP is the biggest trust problem a new token has.

### "Can I build the stonkbrokers system this way?"

No — not through a launchpad. pons produces a plain fungible token in a Uniswap
pool. The stonkbrokers model is a separate custom-contract build layered *on top*
of a token: an NFT collection where each NFT owns a real wallet (ERC-6551) seeded
with tokens at mint, an AMM for the NFTs, and a distributor that pays trading fees
to NFT holders as dividends. Robinhood Chain allows permissionless deployment
(chain ID **4663**), so it is possible — but it is a serious contract project that
needs an audit, and it only pays off once a token has real trading volume.

---

## Contract addresses

`lib/engine/chains.js` carries the addresses from the official pons docs
(Integration → Contracts), for both the active and legacy factories. Two earlier
guesses are corrected: the RPC host is `rpc.mainnet.chain.robinhood.com` (the
version without `mainnet` could not connect at all) and the explorer is
`robinhoodchain.blockscout.com`.

Every value is overridable from the environment. **Check them yourself before real
money is involved** — a wrong or lookalike router address is a classic way wallets
get drained, and `ponfamily.com` (no "s") is not the real site. Type domains
manually.

pons is an interface, not affiliated with Robinhood, and not investment advice.

---

## Security

- The engine is **read-only**: nothing here signs a transaction, holds a private
  key, or spends funds. Trading and launching happen in the user's own wallet.
- `PRIVATE_KEY` in `.env.local` is only for *deploying your own contract*. Use a
  fresh wallet with only the gas it needs. Never paste a key into a chat, a
  website, or a "support" DM.
- `SESSION_SECRET` signs login cookies. Rotating it invalidates all sessions.

## License

MIT
