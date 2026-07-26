import { NextResponse } from "next/server";
import { Contract, JsonRpcProvider, formatEther, formatUnits, getAddress, isAddress } from "ethers";
import {
  buildSendPlan,
  buildTradePlan,
  deriveAddress,
  enrichLaunchesByAddress,
  getChain,
  getEthUsd,
  listLaunched,
  listLaunches,
  loadDirectory,
  looksLikeTicker,
  parseCommand,
  resolveToken,
  spotPrice,
  tokenMeta,
  usdToEth,
  HELP,
} from "@/lib/engine";
import { getSession } from "@/lib/session";

/**
 * POST /api/terminal  { input, network, account?, slippage? }
 *
 * One line of terminal input in, a rendered answer out. Read-only: the worst
 * this endpoint can do is quote a trade. Signing happens in the browser wallet,
 * or — for someone who signed in with X and has no wallet extension, which on a
 * phone is nearly everybody — at `/api/terminal/execute`, which is a separate
 * route precisely so that spending money is a separate decision.
 */

const BALANCE_ABI = ["function balanceOf(address) view returns (uint256)"];
const SUPPLY_ABI = [
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
];

/** How many launches the resolver may see. Enough to cover the live feed. */
const RESOLVE_LIMIT = 24;

function line(text, tone = "out") {
  return { tone, text };
}

function serialise(value) {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

/** Where the caller's money lives: their connected wallet, else their X wallet. */
async function resolveOwner(account, session) {
  if (account && isAddress(account)) return { address: getAddress(account), source: "wallet" };
  if (session?.id) {
    try {
      return { address: deriveAddress(session.id), source: "x" };
    } catch {
      // WALLET_DERIVATION_SECRET missing — not fatal for a read-only command.
    }
  }
  return { address: null, source: null };
}

/**
 * Resolve a ticker against the launch feed first, then the stock/known-token
 * directory. The feed wins on a clash because those are this site's own tokens;
 * the directory is the reach into Robinhood Chain's tokenized stocks and any
 * other named token the operator has listed. An address never needs either.
 */
async function resolveTicker(query, launches, chain) {
  const found = resolveToken(query, launches);
  if (found.ok || found.reason === "ambiguous") return found;

  // A miss on the feed. Only a plain ticker is worth a directory lookup — a
  // full sentence never is, and an address already resolved above.
  if (isAddress(query) || !looksLikeTicker(query)) return found;

  let dir;
  try {
    dir = await loadDirectory(chain.chainId);
  } catch {
    return found;
  }
  if (!dir.tokens.length) {
    return { ...found, directoryEmpty: true, directoryWarning: dir.warning };
  }
  const hit = resolveToken(query, dir.tokens);
  if (hit.ok) return { ...hit, directory: true };
  if (hit.reason === "ambiguous") return hit;
  return { ...found, directoryWarning: dir.warning };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { input, network = "robinhood", account = null, slippage = 5 } = body || {};

  let chain;
  try {
    chain = getChain(network);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const command = parseCommand(input);

  // Answered without touching the chain at all.
  if (command.kind === "empty") return NextResponse.json({ kind: "empty", lines: [] });
  if (command.kind === "clear") return NextResponse.json({ kind: "clear", lines: [] });
  if (command.kind === "help") {
    // Sent as pairs rather than space-padded text: padding only lines up while
    // nothing wraps, and on a phone every one of these lines wraps.
    return NextResponse.json({
      kind: "help",
      data: { commands: HELP.map(([cmd, what]) => ({ cmd, what })) },
      lines: [
        line("Tickers resolve against the launch feed and Robinhood stock tokens. A 0x address always works.", "muted"),
        line("↑ / ↓ walks your history. Tab completes a command.", "muted"),
      ],
    });
  }
  if (command.kind === "login") {
    return NextResponse.json({
      kind: "login",
      lines: [line("Opening X sign-in…")],
      navigate: { signIn: true },
    });
  }
  if (command.kind === "connect") {
    return NextResponse.json({
      kind: "connect",
      lines: [line("Asking your browser wallet to connect…")],
      navigate: { connect: true },
    });
  }
  if (command.kind === "create") {
    return NextResponse.json({
      kind: "create",
      lines: [
        line(
          command.symbol
            ? `Opening the create form for $${command.symbol}${
                command.name ? ` — “${command.name}”` : ""
              }.`
            : "Opening the create form."
        ),
      ],
      navigate: { view: "create", prefill: { symbol: command.symbol, name: command.name } },
    });
  }
  if (command.kind === "error") {
    return NextResponse.json({ kind: "error", lines: [line(command.message, "error")] });
  }
  if (command.kind === "unknown") {
    return NextResponse.json({
      kind: "error",
      lines: [
        line(`Unknown command: ${command.raw}`, "error"),
        line("Type `help` for everything this understands.", "muted"),
      ],
    });
  }

  // Everything below reads the chain.
  const provider = new JsonRpcProvider(chain.rpc, chain.chainId);

  let session = null;
  try {
    session = await getSession();
  } catch {
    /* a broken session must not stop a public price lookup */
  }
  const owner = await resolveOwner(account, session);

  // A dead feed and an empty feed produce the same empty array, and telling
  // someone "no launch called pons" when the truth is "the RPC is unreachable"
  // sends them looking for the wrong problem.
  let feedError = null;
  const [rate, feed] = await Promise.all([
    getEthUsd(),
    listLaunches(provider, chain, { limit: RESOLVE_LIMIT }).catch((error) => {
      feedError = error.message || "the launch feed could not be read";
      return { launches: [] };
    }),
  ]);
  const ethUsd = rate?.usd ?? null;
  const launches = feed.launches || [];

  try {
    switch (command.kind) {
      case "fund": {
        if (!owner.address) {
          return NextResponse.json({
            kind: "error",
            lines: [
              line("No wallet to fund yet.", "error"),
              line(
                session === null && !account
                  ? "`login` with X to mint one, or `connect` a browser wallet."
                  : "The server is missing WALLET_DERIVATION_SECRET, so the X wallet cannot be derived. Set it in the deployment env.",
                "muted"
              ),
            ],
          });
        }
        let eth = null;
        try {
          eth = Number(formatEther(await provider.getBalance(owner.address)));
        } catch {
          /* address still shows even if the balance read fails */
        }
        return NextResponse.json(
          serialise({
            kind: "fund",
            ethUsd,
            data: {
              address: owner.address,
              source: owner.source,
              chain: chain.name,
              chainId: chain.chainId,
              gasSymbol: chain.gasSymbol,
              explorer: chain.explorer,
              eth,
              usd: eth != null && ethUsd ? eth * ethUsd : null,
            },
          })
        );
      }

      case "gas": {
        const [fee, blockNumber] = await Promise.all([
          provider.getFeeData(),
          provider.getBlockNumber().catch(() => null),
        ]);
        const gwei = fee.gasPrice != null ? Number(fee.gasPrice) / 1e9 : null;
        // A plain transfer is 21,000 gas — a figure people can anchor a fee to.
        const transferEth = fee.gasPrice != null ? Number(formatEther(fee.gasPrice * 21000n)) : null;
        return NextResponse.json(
          serialise({
            kind: "gas",
            ethUsd,
            data: {
              gwei,
              blockNumber,
              chain: chain.name,
              transferEth,
              transferUsd: transferEth != null && ethUsd ? transferEth * ethUsd : null,
            },
          })
        );
      }

      case "convert": {
        const { unit, value } = command.amount;
        // "convert $100" defaults to ETH; "convert 0.5 eth" defaults to USD.
        const target = command.target || (unit === "usd" ? "eth" : "usd");
        let result = null;
        if (unit === "usd") {
          const eth = usdToEth(value, ethUsd);
          result =
            target === "eth"
              ? { in: `$${value.toLocaleString("en-US")}`, out: eth != null ? `${eth} ETH` : null }
              : { in: `$${value.toLocaleString("en-US")}`, out: `$${value.toLocaleString("en-US")}` };
        } else {
          // Treat a bare number and "eth" alike as an ETH amount to convert.
          const usd = ethUsd ? value * ethUsd : null;
          result = { in: `${value} ETH`, out: usd != null ? `$${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : null };
        }
        if (!result.out) {
          return NextResponse.json({
            kind: "error",
            lines: [line("No ETH/USD rate is available right now, so that cannot be converted.", "error")],
          });
        }
        return NextResponse.json(
          serialise({
            kind: "convert",
            ethUsd,
            data: { ...result, rate: ethUsd },
          })
        );
      }

      case "send": {
        let token = null;
        if (command.asset === "token") {
          const found = await resolveTicker(command.query, launches, chain);
          if (!found.ok && found.reason === "ambiguous") {
            return NextResponse.json(
              serialise({
                kind: "error",
                lines: [
                  line(`“${command.query}” matches ${found.candidates.length} tokens.`, "error"),
                  ...found.candidates
                    .slice(0, 6)
                    .map((c) => line(`  $${c.symbol || "???"}  ${c.token}`)),
                  line("Use the address to be certain which one you mean.", "muted"),
                ],
              })
            );
          }
          if (!found.ok) {
            return NextResponse.json({
              kind: "error",
              lines: [line(`No token called “${command.query}” to send. Paste its address.`, "error")],
            });
          }
          token = found.token;
        }

        if (!owner.address) {
          return NextResponse.json({
            kind: "error",
            lines: [
              line("No wallet to send from.", "error"),
              line("`connect` a browser wallet, or `login` with X.", "muted"),
            ],
          });
        }

        const built = await buildSendPlan(provider, chain, {
          asset: command.asset,
          token,
          amount: command.amount,
          owner: owner.address,
          to: command.to,
        });
        if (!built.ok) {
          return NextResponse.json({ kind: "error", lines: [line(built.error, "error")] });
        }
        return NextResponse.json(
          serialise({
            kind: "sendplan",
            ethUsd,
            plan: {
              ...built.plan,
              owner: owner.address,
              ownerSource: owner.source,
              network,
              explorer: chain.explorer,
            },
          })
        );
      }

      case "list": {
        const ranked = [...launches].sort(
          (a, b) => (b.marketCapWeth || 0) - (a.marketCapWeth || 0)
        );
        return NextResponse.json(
          serialise({
            kind: "list",
            ethUsd,
            data: { launches: ranked.slice(0, 12), explorer: chain.explorer },
            lines: ranked.length
              ? [
                  line(
                    `${ranked.length} launch${ranked.length === 1 ? "" : "es"} in the current window, biggest first.`,
                    "muted"
                  ),
                ]
              : [line("No launches in the scanned block window.", "muted")],
          })
        );
      }

      case "balance": {
        if (!owner.address) {
          return NextResponse.json({
            kind: "error",
            lines: [
              line("No wallet yet.", "error"),
              line("`connect` to use a browser wallet, or `login` to get one from your X account.", "muted"),
            ],
          });
        }
        const native = await provider.getBalance(owner.address);
        const eth = Number(formatUnits(native, 18));
        return NextResponse.json(
          serialise({
            kind: "balance",
            ethUsd,
            data: {
              address: owner.address,
              source: owner.source,
              eth,
              usd: ethUsd ? eth * ethUsd : null,
              explorer: chain.explorer,
            },
          })
        );
      }

      case "portfolio": {
        if (!owner.address) {
          return NextResponse.json({
            kind: "error",
            lines: [
              line("No wallet yet.", "error"),
              line("`connect` to use a browser wallet, or `login` to get one from your X account.", "muted"),
            ],
          });
        }

        // Scan the feed window AND everything launched through this site. A
        // token you just made or bought can sit outside the feed's block
        // window, and the old scan missed exactly those — so a fresh position
        // showed "0 launches held". Union both, deduped by address.
        let scanTargets = launches;
        try {
          const registry = await listLaunched({ limit: 50 });
          const known = new Set(launches.map((l) => l.token.toLowerCase()));
          const extra = registry.tokens.filter((t) => !known.has(t.toLowerCase()));
          if (extra.length) {
            const enriched = await enrichLaunchesByAddress(provider, chain, extra);
            scanTargets = [...launches, ...enriched];
          }
        } catch {
          /* registry is optional — a feed-only scan is still useful */
        }

        const holdings = [];
        await Promise.all(
          scanTargets.map(async (l) => {
            try {
              const erc20 = new Contract(l.token, BALANCE_ABI, provider);
              const raw = await erc20.balanceOf(owner.address);
              if (raw === 0n) return;
              const qty = Number(formatUnits(raw, l.decimals ?? 18));
              const valueWeth = Number.isFinite(l.priceInWeth) ? qty * l.priceInWeth : null;
              holdings.push({
                token: l.token,
                symbol: l.symbol,
                name: l.name,
                qty,
                priceInWeth: l.priceInWeth ?? null,
                valueWeth,
                valueUsd: valueWeth != null && ethUsd ? valueWeth * ethUsd : null,
              });
            } catch {
              /* one unreadable token must not blank the portfolio */
            }
          })
        );

        holdings.sort((a, b) => (b.valueWeth || 0) - (a.valueWeth || 0));
        const native = await provider.getBalance(owner.address);
        const eth = Number(formatUnits(native, 18));

        return NextResponse.json(
          serialise({
            kind: "portfolio",
            ethUsd,
            data: {
              address: owner.address,
              source: owner.source,
              eth,
              holdings,
              totalWeth:
                eth + holdings.reduce((sum, h) => sum + (h.valueWeth || 0), 0),
              scanned: scanTargets.length,
            },
          })
        );
      }

      case "price":
      case "audit":
      case "buy":
      case "sell": {
        const found = await resolveTicker(command.query, launches, chain);

        if (!found.ok && found.reason === "ambiguous") {
          return NextResponse.json(
            serialise({
              kind: "error",
              lines: [
                line(`“${command.query}” matches ${found.candidates.length} launches.`, "error"),
                ...found.candidates
                  .slice(0, 6)
                  .map((c) => line(`  $${c.symbol || "???"}  ${c.token}  ${c.name || ""}`)),
                line("Use the address to be certain which one you mean.", "muted"),
              ],
            })
          );
        }

        if (!found.ok) {
          // A ticker that looks like a stock but resolved nowhere, on a deploy
          // with no directory configured, is not "no such token" — it is "this
          // deploy cannot reach stock tokens yet". Say which.
          if (found.directoryEmpty && looksLikeTicker(command.query)) {
            return NextResponse.json({
              kind: "error",
              lines: [
                line(`“${command.query}” is not a launch here, and the stock-token directory is empty right now.`, "error"),
                line(
                  found.directoryWarning ||
                    "The Robinhood stock-token API could not be reached from the server. A contract address still works.",
                  "muted"
                ),
              ],
            });
          }
          return NextResponse.json({
            kind: "error",
            lines: feedError
              ? [
                  line(`Could not read the launch feed, so “${command.query}” cannot be resolved to an address.`, "error"),
                  line(feedError, "muted"),
                  line("A contract address still works — it needs no feed lookup.", "muted"),
                ]
              : [
                  line(`No launch or listed token called “${command.query}”.`, "error"),
                  line(
                    "Tickers resolve against the launch feed and the token directory. Paste the contract address to reach any token.",
                    "muted"
                  ),
                ],
          });
        }

        if (command.kind === "audit") {
          return NextResponse.json({
            kind: "audit",
            lines: [line(`Running the full audit on ${found.token}…`)],
            navigate: { view: "audit", token: found.token, runAudit: true },
          });
        }

        if (command.kind === "price") {
          const l = found.launch;

          // A feed launch carries full pool state — use it directly.
          if (l && Number.isFinite(l.priceInWeth) && !l.fromDirectory) {
            return NextResponse.json(
              serialise({
                kind: "price",
                ethUsd,
                data: { ...l, explorer: chain.explorer, matchedBy: found.matchedBy },
              })
            );
          }

          // A stock token: the issuer's own bid/ask is the authoritative price,
          // and it needs no pool to exist. Supply is read on-chain for a cap.
          if (l?.kind === "stock" && l.priceUsd != null) {
            let supplyTokens = null;
            try {
              const erc20 = new Contract(l.token, SUPPLY_ABI, provider);
              const [supply, dec] = await Promise.all([
                erc20.totalSupply(),
                erc20.decimals().catch(() => l.decimals ?? 18),
              ]);
              supplyTokens = Number(formatUnits(supply, Number(dec)));
            } catch {
              /* a stock with an unreadable supply still has a price */
            }
            return NextResponse.json(
              serialise({
                kind: "price",
                ethUsd,
                data: {
                  token: found.token,
                  symbol: l.symbol,
                  name: l.name,
                  kind: "stock",
                  priceUsd: l.priceUsd,
                  marketCapUsd: supplyTokens != null ? l.priceUsd * supplyTokens : null,
                  supplyTokens,
                  currency: l.currency || "USD",
                  tradingHalted: l.tradingHalted || false,
                  explorer: chain.explorer,
                },
                lines: [
                  line(
                    `Price is ${l.symbol}'s issuer bid/ask from Robinhood. Buy/sell here needs a pool on the pons router — try \`buy $5 ${l.symbol}\` to check.`,
                    "muted"
                  ),
                ],
              })
            );
          }

          // A pasted address or other off-feed token: quote it live off the pool.
          const spot = await spotPrice(provider, chain, found.token, { ethUsd });
          if (spot.ok) {
            return NextResponse.json(
              serialise({
                kind: "price",
                ethUsd,
                data: {
                  token: found.token,
                  symbol: (l && l.symbol) || spot.symbol,
                  name: (l && l.name) || spot.name,
                  kind: l?.kind || (found.directory ? "token" : null),
                  priceInWeth: spot.priceInWeth,
                  marketCapWeth: spot.marketCapWeth,
                  supplyTokens: spot.supplyTokens,
                  live: true,
                  explorer: chain.explorer,
                },
              })
            );
          }

          // No WETH pool to quote against — the tokenized-stock-vs-stablecoin
          // case, or simply an untradeable token. Show what we know, honestly.
          const meta = l || (await tokenMeta(provider, found.token));
          return NextResponse.json(
            serialise({
              kind: "price",
              ethUsd,
              data: {
                token: found.token,
                symbol: meta.symbol,
                name: meta.name,
                kind: l?.kind || null,
                offFeed: true,
                explorer: chain.explorer,
              },
              lines: [
                line(
                  `No WETH pool quotes ${meta.symbol || "this token"} right now, so it cannot be priced or traded through the pons router here. \`audit\` still works.`,
                  "muted"
                ),
              ],
            })
          );
        }

        // buy / sell
        const built = await buildTradePlan(provider, chain, {
          side: command.kind,
          token: found.token,
          amount: command.amount,
          owner: owner.address,
          slippagePercent: Number(slippage) || 5,
          ethUsd,
        });

        if (!built.ok) {
          return NextResponse.json({
            kind: "error",
            lines: [
              line(built.error, "error"),
              ...(built.hint ? [line(built.hint, "muted")] : []),
            ],
          });
        }

        return NextResponse.json(
          serialise({
            kind: "plan",
            ethUsd,
            plan: {
              ...built.plan,
              tokenKind: found.launch?.kind || (found.directory ? "token" : "launch"),
              owner: owner.address,
              ownerSource: owner.source,
              network,
              explorer: chain.explorer,
            },
          })
        );
      }

      default:
        return NextResponse.json({
          kind: "error",
          lines: [line(`Nothing handles \`${command.kind}\` yet.`, "error")],
        });
    }
  } catch (error) {
    console.error("Terminal command failed:", error);
    return NextResponse.json(
      {
        kind: "error",
        lines: [
          line(error.message || "The command failed.", "error"),
          line("The Robinhood Chain RPC may be unreachable from the server.", "muted"),
        ],
      },
      { status: 502 }
    );
  }
}
