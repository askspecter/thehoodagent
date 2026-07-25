"use strict";

const crypto = require("node:crypto");
const { Wallet, JsonRpcProvider, formatEther } = require("ethers");

/**
 * Wallets derived from an X account.
 *
 * Signing in with X mints a wallet permanently tied to that account — no seed
 * phrase, no setup — which is the model this product was asked for.
 *
 * The key is DERIVED, never stored: HMAC(masterSecret, xUserId) gives the same
 * private key every time, so there is no key database to leak or to back up. The
 * X user id is used rather than the handle because handles can be changed and
 * reused, and a wallet must not follow a renamed account.
 *
 * The whole scheme rests on WALLET_DERIVATION_SECRET. Anyone holding it can
 * derive every user's key, and rotating it makes every existing wallet
 * unreachable — so it must be set once, kept secret, and never changed.
 */

const DOMAIN = "pons-sentinel/x-wallet/v1";

function masterSecret() {
  const secret = process.env.WALLET_DERIVATION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "WALLET_DERIVATION_SECRET is missing or too short (need 32+ chars). Generate one with:\n" +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
        "Set it once and never change it — changing it orphans every existing wallet."
    );
  }
  return secret;
}

/** Deterministic private key for an X user id. */
function derivePrivateKey(xUserId) {
  if (!xUserId) throw new Error("An X user id is required to derive a wallet.");
  const mac = crypto
    .createHmac("sha512", masterSecret())
    .update(`${DOMAIN}:${xUserId}`)
    .digest();
  // First 32 bytes as the key; secp256k1 rejects zero and values >= n, which is
  // vanishingly unlikely but cheap to guard against.
  const key = mac.subarray(0, 32);
  const hex = "0x" + key.toString("hex");
  try {
    new Wallet(hex);
    return hex;
  } catch {
    // Re-derive with a counter if the first draw was invalid.
    const retry = crypto
      .createHmac("sha512", masterSecret())
      .update(`${DOMAIN}:${xUserId}:1`)
      .digest()
      .subarray(0, 32);
    return "0x" + retry.toString("hex");
  }
}

/** The wallet for an X user. Never send the private key anywhere by default. */
function deriveWallet(xUserId) {
  const privateKey = derivePrivateKey(xUserId);
  const wallet = new Wallet(privateKey);
  return { address: wallet.address, privateKey, wallet };
}

/** Address only — the safe thing to hand to a client. */
function deriveAddress(xUserId) {
  return deriveWallet(xUserId).address;
}

/** A signer bound to the chain, for server-side transactions. */
function deriveSigner(xUserId, chain) {
  const { privateKey } = deriveWallet(xUserId);
  const provider = new JsonRpcProvider(chain.rpc, chain.chainId);
  return new Wallet(privateKey, provider);
}

/** Native balance, formatted and raw. */
async function nativeBalance(address, chain) {
  const provider = new JsonRpcProvider(chain.rpc, chain.chainId);
  const raw = await provider.getBalance(address);
  return { raw: raw.toString(), formatted: formatEther(raw) };
}

module.exports = {
  deriveWallet,
  deriveAddress,
  deriveSigner,
  derivePrivateKey,
  nativeBalance,
};
