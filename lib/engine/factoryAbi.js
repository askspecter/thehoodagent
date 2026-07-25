"use strict";

const { Interface } = require("ethers");

/**
 * Fetch the pons factory's verified ABI from the block explorer at runtime.
 *
 * The published docs give the *read* functions but not the one that creates a
 * launch, and guessing a function signature is how you burn gas on a reverting
 * transaction. Blockscout serves the verified ABI, so we read the real thing
 * instead of guessing, then locate the launch entrypoint inside it.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

/** Blockscout v2, with the older v1 endpoint as a fallback. */
function abiEndpoints(explorer, address) {
  const base = explorer.replace(/\/+$/, "");
  return [
    `${base}/api/v2/smart-contracts/${address}`,
    `${base}/api?module=contract&action=getabi&address=${address}`,
  ];
}

function parseAbiPayload(json) {
  // v2 shape
  if (json && Array.isArray(json.abi)) return json.abi;
  // v1 shape: { status: "1", result: "<json string>" }
  if (json && typeof json.result === "string") {
    try {
      const parsed = JSON.parse(json.result);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchFactoryAbi(explorer, address, { timeoutMs = 12_000 } = {}) {
  const key = `${explorer}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let lastError = null;

  for (const url of abiEndpoints(explorer, address)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        lastError = `${url} → HTTP ${res.status}`;
        continue;
      }
      const abi = parseAbiPayload(await res.json());
      if (abi && abi.length) {
        const value = { abi, source: url };
        cache.set(key, { at: Date.now(), value });
        return value;
      }
      lastError = `${url} → no ABI in response`;
    } catch (error) {
      lastError = `${url} → ${error.name === "AbortError" ? "timed out" : error.message}`;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Could not fetch the factory ABI. Last attempt: ${lastError || "unknown error"}`
  );
}

/** Words that suggest a function creates a launch rather than reading one. */
const LAUNCH_NAME = /^(launch|create|deploy|new)/i;
/** Read-only and clearly-unrelated names we never want to pick. */
const REJECT_NAME = /(withdraw|claim|collect|set|update|transfer|renounce|admin|owner|migrate|rescue)/i;

function isLaunchCandidate(entry) {
  if (entry.type !== "function") return false;
  if (entry.stateMutability === "view" || entry.stateMutability === "pure") return false;
  if (REJECT_NAME.test(entry.name)) return false;
  if (!LAUNCH_NAME.test(entry.name)) return false;

  // A launch takes at least the token's name and symbol, so it must accept
  // string input somewhere — including inside a struct (tuple).
  const takesStrings = JSON.stringify(entry.inputs || []).includes('"string"');
  return takesStrings;
}

/**
 * Flatten a function's inputs into a list the UI can render, descending into a
 * single struct argument (the common "config tuple" shape for launchpads).
 */
function describeInputs(fn) {
  const fields = [];

  const walk = (components, path) => {
    for (const input of components) {
      const nextPath = [...path, input.name || `arg${fields.length}`];
      if (input.type === "tuple" && Array.isArray(input.components)) {
        walk(input.components, nextPath);
      } else {
        fields.push({
          path: nextPath,
          name: input.name || nextPath.join("."),
          type: input.type,
        });
      }
    }
  };

  walk(fn.inputs || [], []);
  return fields;
}

/**
 * Find the factory's launch entrypoint and describe it for the client.
 *
 * Returns every candidate, not just the best one — if the heuristic picks wrong,
 * the UI can show the alternatives rather than silently using a bad guess.
 */
async function discoverLaunchFunction(explorer, address, options = {}) {
  const { abi, source } = await fetchFactoryAbi(explorer, address, options);

  const candidates = abi.filter(isLaunchCandidate).map((fn) => {
    const iface = new Interface([fn]);
    const fragment = iface.getFunction(fn.name);
    return {
      name: fn.name,
      signature: fragment.format("sighash"),
      selector: fragment.selector,
      payable: fn.stateMutability === "payable",
      inputs: fn.inputs || [],
      fields: describeInputs(fn),
      // Prefer the richest signature: a launch takes more configuration than a
      // helper that merely wraps it.
      weight: JSON.stringify(fn.inputs || []).length,
    };
  });

  candidates.sort((a, b) => b.weight - a.weight);

  if (candidates.length === 0) {
    throw new Error(
      "The factory ABI was fetched, but no function looked like a launch entrypoint. " +
        "Inspect it manually on the explorer."
    );
  }

  return { chosen: candidates[0], candidates, abiSource: source, abiSize: abi.length };
}

module.exports = {
  fetchFactoryAbi,
  discoverLaunchFunction,
  describeInputs,
  isLaunchCandidate,
};
