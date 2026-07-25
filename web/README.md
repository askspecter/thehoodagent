# Pons Sentinel — web app

Token auditor for Robinhood Chain / Pons Launchpad. Sign in with X, paste a
token address, and find out whether you could sell it *before* you buy it.

Every check is read-only. The app never asks for a wallet, never requests a
token approval, and cannot move funds.

---

## Setup

```bash
cd web
npm install
cp .env.example .env.local
```

Then fill in `.env.local`:

**1. Session secret** (required)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output as `SESSION_SECRET`. It signs the login cookie — without it,
anyone could forge a session.

**2. X (Twitter) sign-in**

1. Go to <https://developer.x.com> and create a project + app.
2. Open the app's **User authentication settings**.
3. Enable **OAuth 2.0**, and set **App type: Web App** (a confidential client —
   this is what gives you a client secret).
4. Set the **Callback URI** to exactly:
   `http://localhost:3000/api/auth/x/callback`
5. Request scopes `users.read` and `tweet.read`.
6. Copy the Client ID and Client Secret into `X_CLIENT_ID` / `X_CLIENT_SECRET`.

The app stores only your X id, handle, display name, and avatar. It deliberately
**discards the access token** after reading your profile — it never posts on your
behalf, so keeping the token would be a liability with no benefit.

**3. Run it**

```bash
npm run dev     # http://localhost:3000
```

---

## Verifying it works without touching a live network

You do not need real money, a wallet, or even internet RPC access to see the
auditor work. From the repository root:

```bash
npx hardhat node                                           # terminal 1
npx hardhat run scripts/seed-local.js --network localhost  # terminal 2
```

That deploys two fixtures and prints their addresses:

| Fixture | Expected result |
|---|---|
| `MaliciousToken` ("Rug Pull Inu") | **AVOID**, score 100/100 — mint, blacklist, pause, live owner, fee control |
| `PonsFamilyToken` ("$PONS") | Low score — no owner, no privileged functions |

In the web app choose network **Local EVM** and paste an address.

---

## What the audit actually checks

| Check | How |
|---|---|
| **Honeypot** | Simulates buy *and* sell through the real Uniswap V3 pool via QuoterV2 `eth_call`. If the buy quotes but the sell reverts, money goes in and cannot come out. Costs nothing. |
| **Sell tax** | Measures round-trip loss. ~2–4% is normal pool fees; 20%+ means a transfer tax; 50%+ is a soft honeypot. |
| **Owner power** | Scans deployed bytecode for `mint`, `blacklist`, `pause`, `setFee`, `setMaxTxAmount`, and friends by reading PUSH4 selectors out of the dispatcher — works on unverified contracts. |
| **Ownership** | Reads `owner()`. Renounced counts in the token's favour; a live owner holding privileged functions is the worst case. |
| **Upgradeable proxy** | Reads the EIP-1967 / OZ-legacy implementation slots. An upgradeable token can gain a sell block after you buy. |
| **Concentration** | Replays `Transfer` events to rank holders. A pool legitimately holds a large share — the report says so rather than assuming malice. |
| **Liquidity exists** | Asks the V3 factory whether a pool exists at any standard fee tier. |

### What it cannot tell you

Stated in the UI too, because a scanner that oversells itself is dangerous:

- A trap keyed on `tx.origin`, block number, or a per-wallet allowlist can quote
  clean and still fail for you.
- A blacklist can be applied **after** you pass a clean audit.
- An owner who can call `setFee` can raise the tax later.
- Contract safety is not investment quality. Most launchpad tokens go to zero
  with perfectly ordinary contracts.

---

## Contract addresses

`lib/engine/chains.js` now carries the addresses from the official pons
documentation (Integration → Contracts), including both the active and legacy
factories and their start blocks. Every value can be overridden from `.env.local`.

Two earlier values were wrong and are fixed:

| | Was (wrong) | Now (from docs) |
|---|---|---|
| RPC | `rpc.chain.robinhood.com` | `rpc.mainnet.chain.robinhood.com` |
| Explorer | `explorer.chain.robinhood.com` | `robinhoodchain.blockscout.com` |

The bad RPC host meant mainnet audits could not connect at all.

**Still worth checking yourself before real money is involved.** A wrong or
lookalike router address is a classic way wallets get drained, and per the docs
*"names and symbols can be copied — always check the token address."* Note that
`ponfamily.com` (missing the "s") is **not** the real site; type domains manually
rather than following links from social posts.

pons is an interface, not affiliated with Robinhood, and not investment advice.

---

## Deploying to Vercel

**If you got a 404 on Vercel, this is why:** the Next.js app lives in `web/`, not
at the repository root. The root is a Hardhat project. Vercel built from the root,
found no Next.js app, and served nothing.

**The fix — set the root directory:**

1. Vercel project → **Settings → Build and Deployment → Root Directory**
2. Set it to `web`
3. Redeploy

Framework preset should read **Next.js** once the root directory is right. `web/`
has no dependency on any parent directory (the engine lives in `web/lib/engine`),
so nothing outside it is needed at build time.

**Then add environment variables** (Settings → Environment Variables). Without
`SESSION_SECRET` the app returns a setup error instead of signing anyone in:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | 64 hex chars from the command in Setup above |
| `X_CLIENT_ID` | from your X app |
| `X_CLIENT_SECRET` | from your X app |
| `X_REDIRECT_URI` | `https://<your-domain>/api/auth/x/callback` |
| `ROBINHOOD_RPC` | optional; a private RPC avoids public rate limits |
| `AUDIT_MAX_BLOCKS` | optional; `30000` is a sane default |

**Then update the X app** — go back to your app's User authentication settings and
add the production callback URL (`https://<your-domain>/api/auth/x/callback`)
alongside the localhost one. `X_REDIRECT_URI` must match what X has registered
**exactly**, including scheme and any trailing path. A mismatch here is the most
common cause of `token_exchange_failed`.

Cookies switch to `secure` automatically when `NODE_ENV=production`, which Vercel
sets for you.

### Serverless caveats

- **Holder concentration replays `Transfer` logs**, which can be slow. The pons
  docs warn that the public RPC times out on wide `eth_getLogs` ranges — the
  engine already chunks requests and degrades to a partial result rather than
  failing, but on Vercel's default 10s function limit you may need to lower
  `AUDIT_MAX_BLOCKS` or raise `maxDuration`.
- **Rate limiting is in-memory**, so it resets on every cold start and does not
  span instances. Move it to Redis (Upstash) before real traffic.

---

## Production notes

Before putting this in front of real users:

- **Rate limiting is in-memory** (`app/api/audit/route.js`). It resets on restart
  and does not span instances. Move it to Redis.
- **Set `X_REDIRECT_URI`** to your deployed HTTPS callback and register that URL
  with X. Cookies switch to `secure` automatically when `NODE_ENV=production`.
- **Sessions are stateless signed cookies.** There is no revocation list; rotating
  `SESSION_SECRET` invalidates every session at once.
- **The audit replays `Transfer` logs**, which is the slow part. Tune
  `AUDIT_MAX_BLOCKS` and use a paid RPC if you expect traffic.
