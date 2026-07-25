"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Interface, parseEther } from "ethers";
import {
  connect,
  currentAccount,
  hasWallet,
  humanError,
  sendTransaction,
  shortAddress,
  simulate,
  waitForReceipt,
} from "./wallet";

/**
 * Launch a token on this site.
 *
 * The factory's launch signature is not in the published docs, so it is
 * discovered from the verified ABI on the explorer (/api/factory) and the form
 * is built from that. Nothing about the call is hardcoded.
 *
 * The call is always simulated with eth_call before it is sent. A wrong argument
 * then costs a clear error message instead of gas on a reverting transaction.
 */

/**
 * Friendly labels and input hints for the field names launchpads actually use.
 *
 * `hidden` fields are still encoded — the ABI demands every argument — they just
 * are not shown. Discord and Farcaster are hidden as empty strings, and the fee
 * wallet is hidden because it is filled automatically with the launcher's own X
 * wallet rather than being sendable anywhere.
 */
const FIELD_HINTS = [
  { match: /^(name|tokenname)$/i, label: "Token name", placeholder: "Hood Rat" },
  { match: /^(symbol|ticker)$/i, label: "Symbol", placeholder: "HOODRAT" },
  { match: /(logo|image|icon|avatar|uri)/i, label: "Logo", isLogo: true },
  { match: /(description|desc|bio)/i, label: "Description", placeholder: "What is this token?", textarea: true },
  { match: /twitter/i, label: "X", placeholder: "https://x.com/…" },
  { match: /telegram/i, label: "Telegram", placeholder: "https://t.me/…" },
  { match: /website/i, label: "Website", placeholder: "https://…" },
  { match: /discord/i, hidden: true },
  { match: /farcaster/i, hidden: true },
  { match: /(feewallet|feerecipient|feeto|payout|creator)/i, hidden: true, fillWithAccount: true },
  { match: /(initialbuy|devbuy|firstbuy|buyamount)/i, label: "Your first buy (ETH)", placeholder: "0", isEth: true },
];

function hintFor(field) {
  const found = FIELD_HINTS.find((h) => h.match.test(field.name || ""));
  return (
    found || {
      label: field.name || field.path.join("."),
      placeholder: field.type,
    }
  );
}

/** Default value for a field type, so unfilled arguments still encode. */
function emptyFor(type) {
  if (type === "address") return "0x0000000000000000000000000000000000000000";
  if (/^u?int/.test(type)) return "0";
  if (type === "bool") return false;
  if (type.endsWith("[]")) return [];
  return "";
}

/** Rebuild the nested argument structure the ABI expects from a flat value map. */
function buildArgs(inputs, values, pathPrefix = []) {
  return inputs.map((input, index) => {
    const path = [...pathPrefix, input.name || `arg${index}`];
    if (input.type === "tuple" && Array.isArray(input.components)) {
      return buildArgs(input.components, values, path);
    }
    const key = path.join(".");
    const raw = values[key];
    if (raw === undefined || raw === "") return emptyFor(input.type);
    if (/^u?int/.test(input.type)) {
      // ETH-denominated fields are typed in ether but encoded in wei.
      return values[`${key}__isEth`] ? parseEther(String(raw)).toString() : String(raw);
    }
    if (input.type === "bool") return Boolean(raw);
    return raw;
  });
}

export default function LaunchForm({ network, onLaunched }) {
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [account, setAccount] = useState(null);
  const [values, setValues] = useState({});
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  /** The wallet derived from the signed-in X account — where fees go. */
  const [xWallet, setXWallet] = useState(null);
  const [xHandle, setXHandle] = useState(null);

  useEffect(() => {
    currentAccount().then(setAccount);

    fetch(`/api/factory?network=${encodeURIComponent(network)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setMetaError(json.error);
        else setMeta(json);
      })
      .catch(() => setMetaError("Could not reach the factory endpoint."))
      .finally(() => setLoading(false));

    fetch(`/api/wallet?network=${encodeURIComponent(network)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.address) {
          setXWallet(json.address);
          setXHandle(json.handle);
        }
      })
      .catch(() => {});
  }, [network]);

  /** Upload the logo and store the returned URL as the field's value. */
  const uploadLogo = useCallback(async (file, key) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/logo", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) setUploadError(json.error || "Upload failed.");
      else setValues((prev) => ({ ...prev, [key]: json.url }));
    } catch {
      setUploadError("Could not reach the upload endpoint.");
    } finally {
      setUploading(false);
    }
  }, []);

  const fields = useMemo(() => meta?.chosen?.fields || [], [meta]);

  /**
   * Fill the fee wallet automatically. It prefers the X-derived wallet so creator
   * fees follow the X account that launched the token, falling back to the
   * connected browser wallet when nobody is signed in. Either way it is never a
   * free-form field, so fees cannot be pointed somewhere else.
   */
  useEffect(() => {
    const payout = xWallet || account;
    if (!fields.length) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        const hint = hintFor(field);
        const key = field.path.join(".");
        if (hint.fillWithAccount && payout) next[key] = payout;
        if (hint.isEth) next[`${key}__isEth`] = true;
      }
      return next;
    });
  }, [account, xWallet, fields]);

  const setValue = (key, value) => setValues((prev) => ({ ...prev, [key]: value }));

  const doConnect = useCallback(async () => {
    setError(null);
    try {
      setAccount(await connect());
    } catch (err) {
      setError(humanError(err));
    }
  }, []);

  const doLaunch = useCallback(async () => {
    if (!meta?.chosen || !account) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setStatus("Encoding the call…");

    try {
      const fn = meta.chosen;
      const iface = new Interface([
        {
          type: "function",
          name: fn.name,
          inputs: fn.inputs,
          outputs: [],
          stateMutability: fn.payable ? "payable" : "nonpayable",
        },
      ]);

      const args = buildArgs(fn.inputs, values);
      const data = iface.encodeFunctionData(fn.name, args);

      // The launch fee, plus whatever the creator wants to buy at launch.
      const buyKey = fields.find((f) => hintFor(f).isEth)?.path.join(".");
      const buyEth = buyKey ? Number(values[buyKey] || 0) : 0;
      const totalEth = Number(meta.launchFeeEth || 0) + (Number.isFinite(buyEth) ? buyEth : 0);
      const value = fn.payable ? "0x" + parseEther(String(totalEth)).toString(16) : undefined;

      setStatus("Simulating before spending anything…");
      const sim = await simulate({ from: account, to: meta.factory, data, value });
      if (!sim.ok) {
        setError(
          `Simulation reverted, so nothing was sent and no gas was spent. The factory rejected these arguments: ${sim.reason}`
        );
        setStatus(null);
        return;
      }

      setStatus("Confirm in your wallet…");
      const txHash = await sendTransaction({ from: account, to: meta.factory, data, value });

      setStatus("Waiting for the transaction to confirm…");
      const receipt = await waitForReceipt(txHash);

      if (receipt.status === "0x0") {
        setError("The transaction was mined but reverted. Nothing was launched.");
        setStatus(null);
        return;
      }

      // The factory emits TokenLaunched with the new token as the first topic.
      const launchedLog = receipt.logs?.find(
        (log) =>
          log.topics?.[0]?.toLowerCase() ===
          "0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a"
      );
      const token = launchedLog?.topics?.[1]
        ? "0x" + launchedLog.topics[1].slice(-40)
        : null;

      setResult({ txHash, token });
      setStatus(null);

      if (token) {
        // Record it so this site's feed can show its own launches.
        await fetch("/api/registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, txHash, deployer: account }),
        }).catch(() => {});
        onLaunched?.(token);
      }
    } catch (err) {
      setError(humanError(err));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [meta, account, values, fields, onLaunched]);

  return (
    <>
      <section className="hero hero-tight">
        <div className="eyebrow">
          <span className="live-dot" />
          Launch · pons factory
        </div>
        <h1>
          Deploy it here. It lands <em>on pons</em>.
        </h1>
        <p>
          One transaction from your wallet mints a fixed 1,000,000,000 supply and opens a locked
          WETH pool at a 1% fee. Because it goes through the pons factory, the token appears on
          ponsfamily.com immediately — and in the Launches tab here.
        </p>
      </section>

      <div className="console">
        <div className="console-bar">
          <span className="live-dot" />
          FACTORY{" "}
          {meta?.chosen ? `· ${meta.chosen.signature}` : loading ? "· discovering ABI…" : "· unavailable"}
        </div>
        <div className="console-body">
          {loading && (
            <div className="alert">
              <span className="spinner" />
              <span>Reading the factory’s verified ABI from the explorer…</span>
            </div>
          )}

          {metaError && (
            <div className="alert alert-error">
              <span className="alert-icon">✖</span>
              <span>
                <strong>Could not read the factory ABI.</strong> {metaError} The launch form needs
                it to encode the call, and guessing the signature would mean a reverting
                transaction.
              </span>
            </div>
          )}

          {meta?.chosen && (
            <>
              {!account ? (
                <div className="wallet-cta">
                  <button className="btn btn-primary" onClick={doConnect} disabled={!hasWallet()}>
                    Connect wallet
                  </button>
                  <span className="form-note">
                    {hasWallet()
                      ? "Your wallet signs the launch. Nothing is sent until you approve it."
                      : "No browser wallet detected. Install MetaMask or another EVM wallet."}
                  </span>
                </div>
              ) : (
                <div className="form-note wallet-row">
                  <span className="live-dot" /> {shortAddress(account)} · Robinhood Chain
                </div>
              )}

              <div className="fields">
                {fields.map((field) => {
                  const hint = hintFor(field);
                  if (hint.hidden) return null;
                  const key = field.path.join(".");

                  if (hint.isLogo) {
                    return (
                      <div className="field" key={key}>
                        <span className="field-label">Logo</span>
                        <div className="logo-pick">
                          {values[key] ? (
                            <img className="logo-preview" src={values[key]} alt="" />
                          ) : (
                            <div className="logo-preview logo-empty">?</div>
                          )}
                          <div className="logo-controls">
                            <label className="btn logo-btn">
                              {uploading ? (
                                <>
                                  <span className="spinner" />
                                  Uploading…
                                </>
                              ) : values[key] ? (
                                "Change image"
                              ) : (
                                "Upload image"
                              )}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                hidden
                                onChange={(e) => uploadLogo(e.target.files?.[0], key)}
                              />
                            </label>
                            <span className="form-note">PNG, JPEG, WebP or GIF · under 512 KB</span>
                          </div>
                        </div>
                        {uploadError && (
                          <span className="form-note sev-medium">▲ {uploadError}</span>
                        )}
                      </div>
                    );
                  }

                  return (
                    <label className="field" key={key}>
                      <span className="field-label">{hint.label}</span>
                      {hint.textarea ? (
                        <textarea
                          className="input"
                          rows={3}
                          placeholder={hint.placeholder}
                          value={values[key] ?? ""}
                          onChange={(e) => setValue(key, e.target.value)}
                        />
                      ) : (
                        <input
                          className="input"
                          placeholder={hint.placeholder}
                          value={values[key] ?? ""}
                          onChange={(e) => setValue(key, e.target.value)}
                          spellCheck={false}
                        />
                      )}
                    </label>
                  );
                })}
              </div>

              {xWallet && (
                <p className="form-note">
                  Creator fees go to your X wallet <code>{shortAddress(xWallet)}</code> (@
                  {xHandle}) — set automatically, not sendable elsewhere.
                </p>
              )}

              <div className="launch-foot">
                <button
                  className="btn btn-primary"
                  onClick={doLaunch}
                  disabled={busy || !account}
                >
                  {busy ? (
                    <>
                      <span className="spinner" />
                      Launching…
                    </>
                  ) : (
                    `Launch · ${meta.launchFeeEth} ETH fee`
                  )}
                </button>
                <span className="form-note">
                  Simulated first, so a bad argument costs nothing.
                </span>
              </div>

              {status && (
                <div className="alert">
                  <span className="spinner" />
                  <span>{status}</span>
                </div>
              )}

              {error && (
                <div className="alert alert-error">
                  <span className="alert-icon">✖</span>
                  <span>{error}</span>
                </div>
              )}

              {result && (
                <div className="alert">
                  <span className="alert-icon sev-good">✔</span>
                  <span>
                    <strong>Launched.</strong>{" "}
                    {result.token ? (
                      <>
                        Token <code>{result.token}</code> is live and now appears on
                        ponsfamily.com.
                      </>
                    ) : (
                      "The transaction confirmed, but the token address could not be read from the receipt."
                    )}{" "}
                    {meta.explorer && (
                      <a
                        href={`${meta.explorer}/tx/${result.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--accent)" }}
                      >
                        View transaction ↗
                      </a>
                    )}
                  </span>
                </div>
              )}

              {meta.candidates?.length > 1 && (
                <p className="form-note">
                  Using <code>{meta.chosen.signature}</code> — the richest launch-shaped function
                  in the factory ABI. Other candidates found:{" "}
                  {meta.candidates.slice(1).map((c) => c.signature).join(", ")}.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
