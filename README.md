# Pons Family ($PONS)

Fixed-supply ERC-20 token for the Pons Family launch (ponsfamily.com).

> **Status:** the token contract is done, compiled, and tested. The
> "stonkbrokers-style" NFT layer (broker NFTs, ERC-6551 wallets, dividends,
> NFT AMM) is **not built yet** — it is blocked on choosing a chain. See
> [Roadmap](#roadmap) below.

---

## What is in here

| Path | What it is |
|---|---|
| `contracts/PonsFamilyToken.sol` | The $PONS ERC-20 token. 1,000,000,000 fixed supply. |
| `test/PonsFamilyToken.test.js` | Test suite (7 tests, all passing). |
| `scripts/deploy.js` | Deployment script for testnets and mainnets. |
| `hardhat.config.js` | Network + compiler configuration. |
| `.env.example` | Template for your secrets. Copy to `.env`. |

## Token design

$PONS is deliberately boring, because boring is what makes a token safe to buy:

- **Fixed supply.** 1,000,000,000 PONS minted once at deployment. There is no
  `mint()` function, so supply can never be inflated — only reduced via `burn()`.
- **No owner, no admin.** Zero privileged functions. Nobody can pause trading,
  blacklist a wallet, change a fee, or move someone else's tokens.
- **No transfer tax, no hidden hooks.** Anyone holding $PONS can always sell it.

Anyone can verify these claims on a block explorer once the source is verified.

> **Note on rug-safety:** these properties protect the *contract*. They do not by
> themselves protect *liquidity* — an LP owner can still pull the pool. Locking or
> burning the LP tokens is a separate step (see below).

---

## Setup

```bash
npm install
cp .env.example .env    # then fill in PRIVATE_KEY
npm test
```

### If `npm test` fails to download the compiler

Some sandboxed networks block `binaries.soliditylang.org`. Install the compiler
from npm instead and Hardhat will pick it up automatically:

```bash
npm install --no-save solc@0.8.24
```

(`hardhat.config.js` prefers a matching `node_modules/solc` when present, and
falls back to the normal download when it is absent.)

---

## Deploying

**Practice on a testnet first.** Testnet coins are free; mistakes on mainnet are not.

```bash
npm run deploy:bsc-testnet     # or: deploy:base-sepolia
```

When you are confident:

```bash
npm run deploy:bsc             # or: deploy:base / deploy:eth
```

Then verify the source publicly so holders can read the contract:

```bash
npx hardhat verify --network bsc <CONTRACT_ADDRESS> <TREASURY_ADDRESS>
```

### Making $PONS actually tradeable

Deploying the token does **not** make it tradeable. A token with no liquidity
cannot be bought or sold. To open trading you add a liquidity pool on a DEX
(PancakeSwap on BSC, Uniswap on Base/Ethereum), pairing $PONS with a real asset
(BNB / ETH / USDC). **That paired asset is your own capital** — it is what gives
$PONS a price.

After creating the pool, **lock or burn the LP tokens**. Holding withdrawable LP
is the single biggest trust problem for a new token, because it means the pool
can be pulled at any time.

### Security

- `PRIVATE_KEY` controls real money. Use a **fresh** wallet holding only the gas
  you need. Never paste it into a chat, a website, or a "support" DM.
- `.env` is gitignored. Keep it that way.
- Before mainnet, consider a professional audit — especially for the NFT/AMM
  contracts in the roadmap, which hold other people's funds.

---

## Roadmap

The stonkbrokers-style mechanics are a layer **on top of** $PONS. $PONS is the
dividend currency; the NFTs are the thing that earns. Suggested build order —
each stage is useful on its own:

1. **Broker NFT collection + ERC-6551 + seeding.** Each NFT gets its own on-chain
   wallet, pre-loaded with $PONS at mint. This alone creates a redemption floor.
2. **Dividend distributor.** Trading fees accrue to NFT holders. Use a
   pull/claim accumulator — pushing to thousands of wallets is prohibitively
   expensive in gas.
3. **NFT AMM.** Instant buy/sell for NFTs against a pooled bonding curve. This is
   the heaviest piece and the one that most needs an audit; on Ethereum and Base
   an existing protocol (sudoswap v2) may be usable instead of writing one.

**Open decision blocking stage 1:** which chain, and where $PONS liquidity lives.
That determines whether an existing NFT AMM and an ERC-6551 registry are already
deployed, or whether both must be built from scratch.

---

## License

MIT
