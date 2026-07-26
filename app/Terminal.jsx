"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Interface } from "ethers";
import {
  connect,
  currentAccount,
  hasWallet,
  humanError,
  sendTransaction,
  simulate,
  waitForReceipt,
} from "./wallet";
import { fmtEth, fmtQty, fmtUsd, fmtUsdPrice, fullNumber, shortAddr, usdOr } from "./format";

/**
 * The trading terminal.
 *
 * One input. "buy me $5 nvda" is a complete instruction: the ticker resolves
 * against the live launch feed, the dollars convert at the current ETH rate, the
 * pool quotes the fill, and only then is a signature asked for. Nothing is ever
 * sent from a typed line alone, every trade lands as a plan you confirm, with
 * the amounts, the price and the worst case spelled out.
 *
 * Two ways to sign, chosen by what the visitor actually has:
 *
 *  • A browser wallet, if one is injected. Fully non-custodial, same path the
 *    Trade tab uses.
 *  • The wallet derived from their X account, signed server-side, for the phone
 *    browsers that have no extension, which is most of them, and the reason
 *    this terminal is usable at all on a phone.
 */

/**
 * The router call, encoded in the browser for the browser-wallet path. Same
 * signature the server uses; the recipient is the only thing that differs, and
 * it has to be the wallet holding the pen.
 */
const routerIface = new Interface([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

const VERBS = [
  "buy",
  "sell",
  "price",
  "audit",
  "create",
  "balance",
  "portfolio",
  "list",
  "help",
  "clear",
  "connect",
  "login",
];

let nextId = 0;
const makeId = () => `e${(nextId += 1)}`;

export default function Terminal({ network, user, onNavigate, onSignIn }) {
  const [log, setLog] = useState(() => [
    {
      id: makeId(),
      type: "line",
      tone: "muted",
      text: "Type a command. `help` lists everything.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState(null);
  const [slippage, setSlippage] = useState(5);

  /** Per-plan execution state, keyed by log entry id. */
  const [execs, setExecs] = useState({});

  const history = useRef([]);
  const historyIndex = useRef(-1);
  const inputRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    currentAccount().then(setAccount);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [log, execs]);

  const push = useCallback((entries) => {
    const list = Array.isArray(entries) ? entries : [entries];
    setLog((prev) => [...prev, ...list.map((e) => ({ id: makeId(), ...e }))]);
  }, []);

  const setExec = useCallback((id, patch) => {
    setExecs((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const doConnect = useCallback(async () => {
    try {
      const next = await connect();
      setAccount(next);
      push({ type: "line", tone: "good", text: `Wallet connected: ${next}` });
      return next;
    } catch (err) {
      push({ type: "line", tone: "error", text: humanError(err) });
      return null;
    }
  }, [push]);

  /** Send a command to the server and render whatever comes back. */
  const run = useCallback(
    async (raw) => {
      const text = raw.trim();
      if (!text) return;

      history.current = [text, ...history.current.filter((h) => h !== text)].slice(0, 60);
      historyIndex.current = -1;

      push({ type: "line", tone: "cmd", text });
      setBusy(true);

      try {
        const res = await fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: text, network, account, slippage }),
        });
        const json = await res.json();

        if (json.kind === "clear") {
          setLog([]);
          setExecs({});
          return;
        }

        // The card first, then any notes about it, a footnote printed above
        // the thing it annotates reads as a non sequitur.
        if (json.kind === "plan" && json.plan) {
          push({ type: "plan", plan: json.plan, ethUsd: json.ethUsd });
        } else if (json.data) {
          push({ type: json.kind, data: json.data, ethUsd: json.ethUsd });
        }

        if (json.lines?.length) {
          push(json.lines.map((l) => ({ type: "line", tone: l.tone, text: l.text })));
        } else if (!json.data && json.error) {
          push({ type: "line", tone: "error", text: json.error });
        }

        // Commands that hand off to another part of the app.
        const nav = json.navigate;
        if (nav?.signIn) onSignIn?.();
        if (nav?.connect) await doConnect();
        if (nav?.view) onNavigate?.(nav);
      } catch {
        push({ type: "line", tone: "error", text: "Could not reach the terminal API." });
      } finally {
        setBusy(false);
      }
    },
    [network, account, slippage, push, onNavigate, onSignIn, doConnect]
  );

  /** Sign a plan in the visitor's own browser wallet. */
  const executeInBrowser = useCallback(
    async (entryId, plan) => {
      let from = account;
      if (!from) {
        from = await doConnect();
        if (!from) return;
      }

      setExec(entryId, { status: "working", note: null, error: null });

      try {
        if (plan.needsApproval && plan.approvalTx) {
          setExec(entryId, { status: "working", note: "Approve the router in your wallet…" });
          const approveHash = await sendTransaction({
            from,
            to: plan.approvalTx.to,
            data: plan.approvalTx.data,
          });
          setExec(entryId, { status: "working", note: "Waiting for the approval…" });
          await waitForReceipt(approveHash);
        }

        // The recipient is encoded LOCALLY against the wallet that is actually
        // signing. The server built this plan before it necessarily knew which
        // wallet that would be, and sending its calldata unchanged could deliver
        // the output to a different address of the same visitor's, or to the
        // zero address, which burns it.
        setExec(entryId, { status: "working", note: "Simulating before spending anything…" });

        const isBuy = plan.side === "buy";
        const data = routerIface.encodeFunctionData("exactInputSingle", [
          {
            tokenIn: isBuy ? plan.weth : plan.token,
            tokenOut: isBuy ? plan.token : plan.weth,
            fee: plan.poolFee,
            recipient: from,
            deadline: Math.floor(Date.now() / 1000) + 20 * 60,
            amountIn: BigInt(plan.amountInRaw),
            amountOutMinimum: BigInt(plan.minOutRaw),
            sqrtPriceLimitX96: 0n,
          },
        ]);

        const tx = {
          from,
          to: plan.router,
          data,
          value: isBuy ? "0x" + BigInt(plan.amountInRaw).toString(16) : undefined,
        };

        const sim = await simulate(tx);
        if (!sim.ok) {
          setExec(entryId, {
            status: "error",
            error: `Simulation reverted, so nothing was sent and no gas was spent: ${sim.reason}`,
          });
          return;
        }

        setExec(entryId, { status: "working", note: "Confirm the swap in your wallet…" });
        const hash = await sendTransaction(tx);
        setExec(entryId, { status: "working", note: "Waiting for confirmation…" });
        const receipt = await waitForReceipt(hash);

        if (receipt.status === "0x0") {
          setExec(entryId, { status: "error", error: "Mined but reverted. Nothing changed hands." });
        } else {
          setExec(entryId, { status: "done", hash });
        }
      } catch (err) {
        setExec(entryId, { status: "error", error: humanError(err) });
      }
    },
    [account, doConnect, setExec]
  );

  /** Sign a plan server-side with the wallet derived from the X account. */
  const executeWithXWallet = useCallback(
    async (entryId, plan) => {
      setExec(entryId, { status: "working", note: "Signing with your X wallet…", error: null });
      try {
        const res = await fetch("/api/terminal/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: plan.token,
            side: plan.side,
            amountInRaw: plan.amountInRaw,
            expectedOutRaw: plan.amountOutRaw,
            slippage,
            network,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setExec(entryId, {
            status: "error",
            error: json.hint ? `${json.error} ${json.hint}` : json.error || "The trade failed.",
          });
          return;
        }
        setExec(entryId, { status: "done", hash: json.hash, approvalHash: json.approvalHash });
      } catch {
        setExec(entryId, { status: "error", error: "Could not reach the execute endpoint." });
      }
    },
    [network, slippage, setExec]
  );

  const onKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter" && !busy) {
        event.preventDefault();
        const value = input;
        setInput("");
        run(value);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const next = Math.min(historyIndex.current + 1, history.current.length - 1);
        if (next >= 0) {
          historyIndex.current = next;
          setInput(history.current[next]);
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = historyIndex.current - 1;
        historyIndex.current = Math.max(next, -1);
        setInput(next >= 0 ? history.current[next] : "");
        return;
      }

      // Tab completes the verb, and only the verb, completing a ticker would
      // mean guessing which token someone meant to buy.
      if (event.key === "Tab") {
        const word = input.trim();
        if (word && !word.includes(" ")) {
          const match = VERBS.find((v) => v.startsWith(word.toLowerCase()));
          if (match) {
            event.preventDefault();
            setInput(`${match} `);
          }
        }
      }
    },
    [busy, input, run]
  );

  const canUseXWallet = Boolean(user);
  const walletLabel = account
    ? `${shortAddr(account)} · browser wallet`
    : canUseXWallet
      ? `@${user.username} · X wallet`
      : "no wallet";

  return (
    <>
      <section className="hero hero-tight">
        <div className="eyebrow">
          <span className="live-dot" />
          Terminal · natural language trading
        </div>
        <h1>
          Say it. <em>It trades.</em>
          <span className="cursor" />
        </h1>
        <p>
          <code>buy me $5 sonic</code> in plain language. It quotes the fill first, and never sends
          from a typed line alone.
        </p>
      </section>

      <div className="console term-console">
        <div className="console-bar">
          <span className="live-dot" />
          TERMINAL · {walletLabel}
          <span className="nav-spacer" />
          <span className="term-slip">
            slippage
            {[1, 5, 15].map((s) => (
              <button
                key={s}
                className={`term-slip-btn ${slippage === s ? "nav-on" : ""}`}
                onClick={() => setSlippage(s)}
                aria-pressed={slippage === s}
              >
                {s}%
              </button>
            ))}
          </span>
        </div>

        <div
          className="term-screen"
          onClick={(e) => {
            // Clicking dead space focuses the prompt, the way a terminal does,
            // but never steal a click on a button or a link inside the output.
            if (e.target === e.currentTarget) inputRef.current?.focus();
          }}
        >
          {log.map((entry) => (
            <LogEntry
              key={entry.id}
              entry={entry}
              exec={execs[entry.id]}
              account={account}
              user={user}
              hasBrowserWallet={hasWallet()}
              onBrowserExecute={() => executeInBrowser(entry.id, entry.plan)}
              onXExecute={() => executeWithXWallet(entry.id, entry.plan)}
              onCancel={() => setExec(entry.id, { status: "cancelled" })}
              onCommand={run}
              onNavigate={onNavigate}
              onSignIn={onSignIn}
            />
          ))}
          <div ref={endRef} />
        </div>

        <div className="term-input-row">
          <span className="term-prompt" aria-hidden="true">
            {busy ? <span className="spinner" /> : "▸"}
          </span>
          <input
            ref={inputRef}
            className="term-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="buy me $5 sonic"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label="Terminal command"
            disabled={busy}
          />
        </div>
      </div>

      <p className="form-note term-foot">
        Simulated before signing, so a bad trade costs nothing, but a quote is not a guarantee.
        Run <code>audit</code> before you buy.
      </p>
    </>
  );
}

function LogEntry({
  entry,
  exec,
  account,
  user,
  hasBrowserWallet,
  onBrowserExecute,
  onXExecute,
  onCancel,
  onCommand,
  onNavigate,
  onSignIn,
}) {

  if (entry.type === "line") {
    return <div className={`term-line term-${entry.tone || "out"}`}>{entry.text}</div>;
  }

  if (entry.type === "plan") {
    return (
      <PlanCard
        plan={entry.plan}
        ethUsd={entry.ethUsd}
        exec={exec}
        account={account}
        user={user}
        hasBrowserWallet={hasBrowserWallet}
        onBrowserExecute={onBrowserExecute}
        onXExecute={onXExecute}
        onCancel={onCancel}
        onSignIn={onSignIn}
      />
    );
  }

  if (entry.type === "help") {
    return <HelpCard data={entry.data} onCommand={onCommand} />;
  }

  if (entry.type === "price") {
    return <PriceCard data={entry.data} ethUsd={entry.ethUsd} onCommand={onCommand} />;
  }

  if (entry.type === "balance") {
    return <BalanceCard data={entry.data} />;
  }

  if (entry.type === "portfolio") {
    return <PortfolioCard data={entry.data} ethUsd={entry.ethUsd} onCommand={onCommand} />;
  }

  if (entry.type === "list") {
    return <ListCard data={entry.data} ethUsd={entry.ethUsd} onCommand={onCommand} />;
  }

  return null;
}

function PlanCard({
  plan,
  ethUsd,
  exec,
  account,
  user,
  hasBrowserWallet,
  onBrowserExecute,
  onXExecute,
  onCancel,
  onSignIn,
}) {
  const isBuy = plan.side === "buy";
  const status = exec?.status;

  const pay = isBuy
    ? `${fmtEth(plan.ethIn)}${plan.usdIn ? ` · ${fmtUsd(plan.usdIn)}` : ""}`
    : `${fmtQty(plan.tokensIn)} $${plan.symbol}`;
  const receive = isBuy
    ? `${fmtQty(plan.tokensOut)} $${plan.symbol}`
    : `${fmtEth(plan.ethOut)}${plan.usdOut ? ` · ${fmtUsd(plan.usdOut)}` : ""}`;

  const worstCase = isBuy
    ? `${fmtQty(Number(plan.minOutRaw) / 10 ** plan.decimals)} $${plan.symbol}`
    : `${fmtEth(Number(plan.minOutRaw) / 1e18)}`;

  return (
    <div className={`term-card ${isBuy ? "term-card-buy" : "term-card-sell"}`}>
      <div className="term-card-head">
        <span className="term-tag">{isBuy ? "BUY" : "SELL"}</span>
        <span className="term-card-title">
          ${plan.symbol} {plan.name ? <em>{plan.name}</em> : null}
        </span>
        <span className="term-card-sub">{plan.basis}</span>
      </div>

      <div className="term-grid">
        <div>
          <div className="term-k">You pay</div>
          <div className="term-v">{pay}</div>
        </div>
        <div>
          <div className="term-k">You receive (est.)</div>
          <div className="term-v">{receive}</div>
        </div>
        <div>
          <div className="term-k">Worst case at {plan.slippagePercent}%</div>
          <div className="term-v term-v-min">{worstCase}</div>
        </div>
        <div>
          <div className="term-k">Fill price</div>
          <div className="term-v" title={fullNumber(plan.executionPriceWeth, "WETH")}>
            {usdOr(plan.executionPriceWeth, ethUsd, fmtUsdPrice)}
          </div>
        </div>
      </div>

      <div className="term-card-meta">
        {plan.token} · {plan.poolFee / 10_000}% pool fee
        {plan.needsApproval && " · needs an ERC-20 approval first"}
      </div>

      {!status && (
        <div className="term-actions">
          {user ? (
            <button className="btn btn-primary" onClick={onXExecute}>
              Confirm
            </button>
          ) : (
            <button className="btn btn-x" onClick={onSignIn}>
              Sign in with X to trade
            </button>
          )}
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}

      {status === "working" && (
        <div className="alert">
          <span className="spinner" />
          <span>{exec.note || "Working…"}</span>
        </div>
      )}

      {status === "cancelled" && <div className="term-line term-muted">Cancelled. Nothing was sent.</div>}

      {status === "error" && (
        <div className="alert alert-error">
          <span className="alert-icon">✖</span>
          <span>{exec.error}</span>
        </div>
      )}

      {status === "done" && (
        <div className="alert">
          <span className="alert-icon sev-good">✔</span>
          <span>
            <strong>Filled.</strong>{" "}
            {plan.explorer ? (
              <a
                href={`${plan.explorer}/tx/${exec.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--lime)" }}
              >
                View transaction ↗
              </a>
            ) : (
              exec.hash
            )}
            {plan.side === "sell" && " Proceeds arrive as WETH."}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The command list. A grid rather than padded text, because the padding that
 * lines these up on a laptop falls apart the moment a line wraps on a phone.
 */
function HelpCard({ data, onCommand }) {
  return (
    <div className="term-card">
      <div className="term-card-head">
        <span className="term-tag">COMMANDS</span>
      </div>
      <dl className="term-help">
        {data.commands.map(({ cmd, what }) => (
          <div className="term-help-row" key={cmd}>
            <dt>
              <button className="term-help-cmd" onClick={() => onCommand(cmd)} title="Run this">
                {cmd}
              </button>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PriceCard({ data, ethUsd, onCommand }) {
  if (data.offFeed) {
    return (
      <div className="term-card">
        <div className="term-card-head">
          <span className="term-tag">TOKEN</span>
          <span className="term-card-title">
            ${data.symbol} {data.name ? <em>{data.name}</em> : null}
          </span>
        </div>
        <div className="term-card-meta">{data.token}</div>
      </div>
    );
  }

  const grad = data.graduated;

  return (
    <div className="term-card">
      <div className="term-card-head">
        <span className="term-tag">{grad === true ? "GRAD" : "TRADING"}</span>
        <span className="term-card-title">
          ${(data.symbol || "???").replace(/^\$/, "")}{" "}
          {data.name ? <em>{data.name}</em> : null}
        </span>
      </div>

      <div className="term-grid">
        <div>
          <div className="term-k">Price</div>
          <div className="term-v" title={fullNumber(data.priceInWeth, "WETH")}>
            {usdOr(data.priceInWeth, ethUsd, fmtUsdPrice)}
          </div>
          <div className="term-k">{fmtEth(data.priceInWeth)}</div>
        </div>
        <div>
          <div className="term-k">Market cap</div>
          <div className="term-v" title={fullNumber(data.marketCapWeth, "WETH")}>
            {usdOr(data.marketCapWeth, ethUsd)}
          </div>
          <div className="term-k">{fmtEth(data.marketCapWeth)}</div>
        </div>
        <div>
          <div className="term-k">Supply</div>
          <div className="term-v">{fmtQty(data.supplyTokens)}</div>
        </div>
        <div>
          <div className="term-k">Graduation</div>
          <div className="term-v">
            {data.graduationProgress != null
              ? `${Math.min(100, data.graduationProgress * 100).toFixed(1)}%`
              : ","}
          </div>
          {data.pairedEth != null && (
            <div className="term-k">
              {Number(data.pairedEth).toFixed(3)} / {Number(data.thresholdEth).toFixed(2)} Ξ
            </div>
          )}
        </div>
      </div>

      <div className="term-card-meta">{data.token}</div>

      <div className="term-actions">
        <button className="btn" onClick={() => onCommand(`buy $5 ${data.token}`)}>
          buy $5
        </button>
        <button className="btn" onClick={() => onCommand(`sell all ${data.token}`)}>
          sell all
        </button>
        <button className="btn btn-ghost" onClick={() => onCommand(`audit ${data.token}`)}>
          audit
        </button>
      </div>
    </div>
  );
}

function BalanceCard({ data }) {
  return (
    <div className="term-card">
      <div className="term-card-head">
        <span className="term-tag">WALLET</span>
        <span className="term-card-title">{shortAddr(data.address)}</span>
        <span className="term-card-sub">
          {data.source === "x" ? "derived from your X account" : "browser wallet"}
        </span>
      </div>
      <div className="term-grid">
        <div>
          <div className="term-k">ETH</div>
          <div className="term-v">{fmtEth(data.eth, { symbol: "ETH" })}</div>
        </div>
        <div>
          <div className="term-k">Value</div>
          <div className="term-v">{data.usd != null ? fmtUsd(data.usd) : ","}</div>
        </div>
      </div>
      <div className="term-card-meta">{data.address}</div>
    </div>
  );
}

function PortfolioCard({ data, ethUsd, onCommand }) {
  if (!data.holdings.length) {
    return (
      <div className="term-card">
        <div className="term-card-head">
          <span className="term-tag">PORTFOLIO</span>
          <span className="term-card-title">{fmtEth(data.eth, { symbol: "ETH" })} and no launches</span>
        </div>
        <div className="term-card-meta">
          Checked {data.scanned} launches in the current window against {shortAddr(data.address)}.
        </div>
      </div>
    );
  }

  return (
    <div className="term-card">
      <div className="term-card-head">
        <span className="term-tag">PORTFOLIO</span>
        <span className="term-card-title">{usdOr(data.totalWeth, ethUsd)}</span>
        <span className="term-card-sub">
          {shortAddr(data.address)} · {fmtEth(data.eth, { symbol: "ETH" })} plus{" "}
          {data.holdings.length} launch{data.holdings.length === 1 ? "" : "es"}
        </span>
      </div>

      <div className="term-rows">
        {data.holdings.map((h) => (
          <button
            key={h.token}
            className="term-row"
            onClick={() => onCommand(`price ${h.token}`)}
            title={`${h.token}, click to price it`}
          >
            <span className="term-row-sym">${(h.symbol || "???").replace(/^\$/, "")}</span>
            <span className="term-row-qty">{fmtQty(h.qty)}</span>
            <span className="term-row-val">{usdOr(h.valueWeth, ethUsd)}</span>
          </button>
        ))}
      </div>

      <div className="term-card-meta">
        Only launches inside the scanned block window are checked, so a very old holding can be
        missing from this list.
      </div>
    </div>
  );
}

function ListCard({ data, ethUsd, onCommand }) {
  if (!data.launches.length) return null;
  return (
    <div className="term-card">
      <div className="term-card-head">
        <span className="term-tag">FEED</span>
        <span className="term-card-title">Launches by market cap</span>
      </div>
      <div className="term-rows">
        {data.launches.map((l, i) => (
          <button
            key={l.token}
            className="term-row"
            onClick={() => onCommand(`price ${l.token}`)}
            title={`${l.token}, click to price it`}
          >
            <span className="term-row-rank">{String(i + 1).padStart(2, "0")}</span>
            <span className="term-row-sym">${(l.symbol || "???").replace(/^\$/, "")}</span>
            <span className="term-row-qty" title={fullNumber(l.priceInWeth, "WETH")}>
              {usdOr(l.priceInWeth, ethUsd, fmtUsdPrice)}
            </span>
            <span className="term-row-val" title={fullNumber(l.marketCapWeth, "WETH")}>
              {usdOr(l.marketCapWeth, ethUsd)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
