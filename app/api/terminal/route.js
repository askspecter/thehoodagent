import { NextResponse } from "next/server";
import { Contract, JsonRpcProvider, formatUnits, getAddress, isAddress } from "ethers";
import {
  buildTradePlan,
  deriveAddress,
  getChain,
  getEthUsd,
  listLaunches,
  parseCommand,
  resolveToken,
  tokenMeta,
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
        line("Tickers resolve against the live launch feed. A 0x address always works.", "muted"),
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

        const holdings = [];
        await Promise.all(
          launches.map(async (l) => {
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
              scanned: launches.length,
            },
          })
        );
      }

      case "price":
      case "audit":
      case "buy":
      case "sell": {
        const found = resolveToken(command.query, launches);

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
          return NextResponse.json({
            kind: "error",
            lines: feedError
              ? [
                  line(`Could not read the launch feed, so “${command.query}” cannot be resolved to an address.`, "error"),
                  line(feedError, "muted"),
                  line("A contract address still works — it needs no feed lookup.", "muted"),
                ]
              : [
                  line(`No launch called “${command.query}” in the current window.`, "error"),
                  line(
                    "Tickers resolve against launches the feed can see. Paste the contract address to reach any token.",
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
          if (!l) {
            const meta = await tokenMeta(provider, found.token);
            return NextResponse.json(
              serialise({
                kind: "price",
                ethUsd,
                data: {
                  token: found.token,
                  symbol: meta.symbol,
                  name: meta.name,
                  offFeed: true,
                  explorer: chain.explorer,
                },
                lines: [
                  line(
                    "This token is not in the launch feed, so there is no pons pool data for it. `audit` still works.",
                    "muted"
                  ),
                ],
              })
            );
          }
          return NextResponse.json(
            serialise({
              kind: "price",
              ethUsd,
              data: { ...l, explorer: chain.explorer, matchedBy: found.matchedBy },
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
