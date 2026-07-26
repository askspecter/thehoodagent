"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { shortAddress } from "./wallet";
import { XLogo } from "./constants";

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
 * `hidden` fields are still encoded, the ABI demands every argument, they just
 * are not shown. Discord and Farcaster are hidden as empty strings, and the fee
 * wallet is hidden because it is filled automatically with the launcher's own X
 * wallet rather than being sendable anywhere.
 */
const FIELD_HINTS = [
  { match: /^(name|tokenname)$/i, label: "Token name", placeholder: "Name your token" },
  { match: /^(symbol|ticker)$/i, label: "Symbol", placeholder: "TICKER" },
  { match: /(logo|image|icon|avatar|uri)/i, label: "Logo", isLogo: true },
  { match: /(description|desc|bio)/i, label: "Description", placeholder: "What is this token?", textarea: true },
  { match: /twitter/i, label: "X", placeholder: "https://x.com/…" },
  { match: /telegram/i, label: "Telegram", placeholder: "https://t.me/…" },
  { match: /website/i, label: "Website", placeholder: "https://…" },
  { match: /discord/i, hidden: true },
  { match: /farcaster/i, hidden: true },
  { match: /(feewallet|feerecipient|feeto|payout|creator)/i, hidden: true, fillWithAccount: true },
  { match: /(initialbuy|devbuy|firstbuy|buyamount)/i, label: "Your first buy (ETH)", placeholder: "0", isEth: true },

  /*
   * Protocol plumbing, not decisions. Asking someone launching a memecoin to
   * supply a `bytes32` is not a question they can answer, and every one of these
   * has exactly one right value:
   *
   *   launchConfigId / dexId, 0 selects the factory's default configuration and
   *     its default DEX, which is the only pons launch route this app supports.
   *   salt, the CREATE2 salt. It must be UNIQUE, not zero: reusing a salt
   *     derives an address that already has code and the deployment reverts. So
   *     it is generated fresh per form rather than defaulted.
   */
  { match: /^(launchconfigid|configid|launchconfig)$/i, hidden: true },
  { match: /^(dexid|dex)$/i, hidden: true },
  { match: /^salt$/i, hidden: true, fillWithSalt: true },
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

/**
 * A fresh CREATE2 salt.
 *
 * Unique per launch on purpose: a repeated salt derives an address that already
 * holds code, and the factory reverts. `crypto.getRandomValues` is the browser's
 * CSPRNG, `Math.random` would eventually collide. The salt is filled into the
 * form and the whole value map is sent to the server, which encodes the call.
 */
function randomSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function LaunchForm({ network, onLaunched, prefill = null, user, onSignIn }) {
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [values, setValues] = useState({});
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  /** The wallet derived from the signed-in X account, where fees go. */
  const [xWallet, setXWallet] = useState(null);
  const [xHandle, setXHandle] = useState(null);

  useEffect(() => {
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
   * Fill the fee wallet automatically with the X-derived wallet, so creator fees
   * always follow the X account that created the token. It is never a free-form
   * field, and the server forces it again at signing time, so fees cannot be
   * pointed somewhere else.
   */
  useEffect(() => {
    if (!fields.length) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        const hint = hintFor(field);
        const key = field.path.join(".");
        if (hint.fillWithAccount && xWallet) next[key] = xWallet;
        if (hint.isEth) next[`${key}__isEth`] = true;
        // Generated once and kept: re-rolling on every render would change the
        // address between the simulation and the transaction.
        if (hint.fillWithSalt && !next[key]) next[key] = randomSalt();
      }
      return next;
    });
  }, [xWallet, fields]);

  /**
   * `create HOOD Hood Rat` in the terminal lands here. Only fields the visitor
   * has not already typed into are filled, so arriving from the terminal a
   * second time cannot overwrite work in progress.
   */
  useEffect(() => {
    if (!prefill || !fields.length) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        const hint = hintFor(field);
        const key = field.path.join(".");
        if (next[key]) continue;
        if (prefill.symbol && /^(symbol|ticker)$/i.test(field.name || "")) {
          next[key] = prefill.symbol;
        }
        if (prefill.name && /^(name|tokenname)$/i.test(field.name || "") && !hint.isLogo) {
          next[key] = prefill.name;
        }
      }
      return next;
    });
  }, [prefill, fields]);

  const setValue = (key, value) => setValues((prev) => ({ ...prev, [key]: value }));

  /**
   * Create the token, signed by the X wallet on the server. No browser wallet:
   * signing in with X already gave the caller a wallet, so there is nothing to
   * connect. The whole value map is sent; the server forces the fee wallet to the
   * caller's own address, simulates, and signs.
   */
  const doLaunch = useCallback(async () => {
    if (!meta?.chosen || !user) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setStatus("Signing with your X wallet…");

    try {
      const fn = meta.chosen;
      const feePath = fields.find((f) => hintFor(f).fillWithAccount)?.path.join(".") || null;
      const buyKey = fields.find((f) => hintFor(f).isEth)?.path.join(".");
      const buyEth = buyKey ? Number(values[buyKey] || 0) : 0;

      const res = await fetch("/api/launch/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fnName: fn.name,
          fnInputs: fn.inputs,
          values,
          feePath,
          buyEth,
          network,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.hint ? `${json.error} ${json.hint}` : json.error || "The launch failed.");
        setStatus(null);
        return;
      }

      setResult({ txHash: json.hash, token: json.token });
      setStatus(null);

      if (json.token) {
        // Record it so this site's feed can show its own launches.
        await fetch("/api/registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: json.token,
            txHash: json.hash,
            deployer: json.owner,
            xUsername: user?.username || null,
          }),
        }).catch(() => {});
        onLaunched?.(json.token);
      }
    } catch {
      setError("Could not reach the create endpoint.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [meta, user, values, fields, network, onLaunched]);

  return (
    <>
      <section className="hero hero-tight">
        <div className="eyebrow">
          <span className="live-dot" />
          Create · pons factory
        </div>
        <h1>
          Create it here. It lands <em>on pons</em>.
          <span className="cursor" />
        </h1>
        <p>
          One transaction from your wallet mints a fixed 1,000,000,000 supply and opens a locked
          WETH pool at a 1% fee. Because it goes through the pons factory, the token appears on
          ponsfamily.com immediately, and in the Launches tab here.
        </p>
      </section>

      <div className="console">
        {/* The raw ABI signature used to be the headline here. It is a fact about
            the call, not a thing anyone reads while naming a token, it moved to
            the technical details at the foot of the form. */}
        <div className="console-bar">
          <span className="live-dot" />
          FACTORY{" "}
          {meta?.factory ? (
            <>
              · <span className="bar-mono">{shortAddress(meta.factory)}</span>
            </>
          ) : loading ? (
            "· reading the ABI…"
          ) : (
            "· unavailable"
          )}
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
              {user ? (
                <div className="form-note wallet-row">
                  <span className="live-dot" /> Creating with your X wallet
                  {xWallet ? ` ${shortAddress(xWallet)}` : ""} · @{user.username}
                </div>
              ) : (
                <div className="wallet-cta">
                  <button className="btn btn-x" onClick={onSignIn}>
                    <XLogo /> Sign in with X to create
                  </button>
                  <span className="form-note">
                    Signing in with X gives you a wallet automatically, so there is nothing to
                    connect. It signs the launch for you.
                  </span>
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
                  {xHandle}), set automatically, not sendable elsewhere.
                </p>
              )}

              <div className="launch-foot">
                <button className="btn btn-primary" onClick={doLaunch} disabled={busy || !user}>
                  {busy ? (
                    <>
                      <span className="spinner" />
                      Creating…
                    </>
                  ) : (
                    `Create · ${meta.launchFeeEth} ETH fee`
                  )}
                </button>
                <span className="form-note">
                  {user
                    ? "Simulated first, so a bad argument costs nothing. Paid from your X wallet."
                    : "Sign in with X above to create."}
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
                    <strong>Created.</strong>{" "}
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

              {/* Folded away, not dropped. Which function this form will call is
                  a real safety property, it just does not belong above the
                  fields someone is filling in. */}
              <details className="tech">
                <summary>Technical details</summary>
                <dl className="tech-list">
                  <dt>Factory</dt>
                  <dd>{meta.factory}</dd>
                  <dt>Function</dt>
                  <dd>
                    <code>{meta.chosen.signature}</code>
                  </dd>
                  <dt>Selector</dt>
                  <dd>{meta.chosen.selector}</dd>
                  {meta.candidates?.length > 1 && (
                    <>
                      <dt>Other candidates</dt>
                      <dd>{meta.candidates.slice(1).map((c) => c.signature).join(", ")}</dd>
                    </>
                  )}
                </dl>
                <p className="form-note">
                  The form is built from the factory’s own verified ABI, so nothing about the
                  call is hardcoded. <code>launchConfigId</code>, <code>dexId</code> and{" "}
                  <code>salt</code> are filled automatically, the first two select the
                  factory’s defaults, and the salt is a fresh random value so the deployment
                  address cannot collide with an existing one.
                </p>
              </details>
            </>
          )}
        </div>
      </div>
    </>
  );
}
