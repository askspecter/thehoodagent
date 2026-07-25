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

## ⚠️ Verify the Pons addresses before risking money

The Pons factory / router / quoter / WETH addresses in `agent/lib/chains.js` were
transcribed from **third-party reporting** of the Pons documentation, not read
from the official docs directly. Check every one against
<https://docs.ponsfamily.com/> and the Robinhood Chain explorer, then override
them in `.env.local`.

A wrong or lookalike router address is one of the most common ways wallets get
drained. Note also that `ponfamily.com` (missing the "s") is **not** the real
site — type domains manually rather than following links from social posts.

Pons is not affiliated with Robinhood.

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
