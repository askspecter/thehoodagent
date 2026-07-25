"use client";

/**
 * Browser wallet plumbing for Robinhood Chain.
 *
 * Everything here runs in the visitor's browser and talks to their injected
 * wallet (EIP-1193). Launch and trade transactions are signed there, which is
 * also how a token launched on this site lands in the pons factory under the
 * visitor's own address.
 */

export const ROBINHOOD = {
  chainIdDecimal: 4663,
  chainIdHex: "0x1237", // 4663
  chainName: "Robinhood Chain",
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

export function getInjected() {
  if (typeof window === "undefined") return null;
  return window.ethereum || null;
}

export function hasWallet() {
  return Boolean(getInjected());
}

/** Ask the wallet to switch to Robinhood Chain, adding it if it is unknown. */
export async function ensureChain() {
  const eth = getInjected();
  if (!eth) throw new Error("No browser wallet found. Install MetaMask or another EVM wallet.");

  const current = await eth.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === ROBINHOOD.chainIdHex) return;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ROBINHOOD.chainIdHex }],
    });
  } catch (error) {
    // 4902 = chain not known to the wallet yet, so offer to add it.
    if (error?.code === 4902 || /unrecognized chain/i.test(error?.message || "")) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ROBINHOOD.chainIdHex,
            chainName: ROBINHOOD.chainName,
            rpcUrls: ROBINHOOD.rpcUrls,
            blockExplorerUrls: ROBINHOOD.blockExplorerUrls,
            nativeCurrency: ROBINHOOD.nativeCurrency,
          },
        ],
      });
      return;
    }
    throw error;
  }
}

/** Prompt for accounts, then make sure we are on the right chain. */
export async function connect() {
  const eth = getInjected();
  if (!eth) throw new Error("No browser wallet found. Install MetaMask or another EVM wallet.");

  const accounts = await eth.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("Wallet returned no accounts.");
  await ensureChain();
  return accounts[0];
}

export async function currentAccount() {
  const eth = getInjected();
  if (!eth) return null;
  try {
    const accounts = await eth.request({ method: "eth_accounts" });
    return accounts?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Simulate a call before sending it.
 *
 * This is the difference between a failed transaction that costs gas and a clear
 * message that costs nothing: eth_call runs the exact same calldata against
 * current state and reverts if it would revert for real.
 */
export async function simulate({ from, to, data, value }) {
  const eth = getInjected();
  const params = { from, to, data };
  if (value) params.value = value;
  try {
    await eth.request({ method: "eth_call", params: [params, "latest"] });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: humanError(error) };
  }
}

export async function sendTransaction({ from, to, data, value }) {
  const eth = getInjected();
  const params = { from, to, data };
  if (value) params.value = value;
  return eth.request({ method: "eth_sendTransaction", params: [params] });
}

/** Poll for a receipt. Robinhood Chain blocks are fast, so this is cheap. */
export async function waitForReceipt(hash, { timeoutMs = 120_000, intervalMs = 2_000 } = {}) {
  const eth = getInjected();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await eth.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timed out waiting for the transaction receipt.");
}

export function humanError(error) {
  const code = error?.code;
  if (code === 4001) return "You rejected the request in your wallet.";
  if (code === -32002) return "Your wallet already has a pending request — open it and respond.";

  const raw = error?.data?.message || error?.shortMessage || error?.message || String(error);
  return String(raw).replace(/^execution reverted:?\s*/i, "").slice(0, 240) || "Transaction failed.";
}

export function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}
