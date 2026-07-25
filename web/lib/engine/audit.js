"use strict";

const { Contract, JsonRpcProvider, ZeroAddress, formatUnits, getAddress } = require("ethers");
const {
  PROXY_SLOTS,
  scanCapabilities,
  scanDangerousOpcodes,
  looksLikeERC20,
  codeSize,
} = require("./bytecode");
const { simulateRoundTrip } = require("./simulate");
const { readLaunch } = require("./pons");

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const OWNER_ABI = [
  "function owner() view returns (address)",
  "function getOwner() view returns (address)",
];

/** Addresses that mean "nobody controls this" or "these tokens are gone". */
const BURN_ADDRESSES = new Set([
  ZeroAddress.toLowerCase(),
  "0x000000000000000000000000000000000000dead",
]);

function finding(severity, id, title, detail) {
  return { severity, id, title, detail };
}

/** Try a call, and return `fallback` instead of throwing. */
async function attempt(promiseFactory, fallback = null) {
  try {
    return await promiseFactory();
  } catch {
    return fallback;
  }
}

/**
 * Read a raw storage slot and return it as an address, or null if empty.
 * Used to detect upgradeable proxies, whose logic can be swapped after you buy.
 */
async function readAddressSlot(provider, address, slot) {
  const raw = await attempt(() => provider.getStorage(address, slot));
  if (!raw) return null;
  const tail = raw.slice(-40);
  if (/^0+$/.test(tail)) return null;
  return getAddress("0x" + tail);
}

/**
 * Reconstruct holder balances from Transfer events.
 *
 * This is a full replay, so it is only practical for young tokens — which is
 * exactly the case on a launchpad. `maxBlocks` and `chunkSize` keep it from
 * hammering a public RPC into rate-limiting us.
 */
async function analyseHolders(provider, address, { fromBlock, toBlock, chunkSize = 2000 }) {
  const token = new Contract(address, ERC20_ABI, provider);
  const balances = new Map();
  const filter = token.filters.Transfer();
  let events = 0;

  const add = (who, delta) => {
    const key = who.toLowerCase();
    balances.set(key, (balances.get(key) || 0n) + delta);
  };

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    const logs = await attempt(() => token.queryFilter(filter, start, end), null);
    if (logs === null) {
      // Range rejected by the RPC — report what we have rather than failing.
      return { balances, events, complete: false };
    }
    for (const log of logs) {
      events += 1;
      const { from, to, value } = log.args;
      add(from, -value);
      add(to, value);
    }
  }

  return { balances, events, complete: true };
}

function topHolders(balances, totalSupply, limit = 10) {
  const rows = [...balances.entries()]
    .filter(([addr, bal]) => bal > 0n && !BURN_ADDRESSES.has(addr))
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, limit);

  return rows.map(([address, balance]) => ({
    address,
    balance,
    percent: totalSupply > 0n ? Number((balance * 10000n) / totalSupply) / 100 : 0,
  }));
}

/**
 * Audit a token contract.
 *
 * Every check is read-only: this never sends a transaction, never needs a
 * private key, and cannot spend anything. Safe to run against any address.
 */
async function auditToken(address, chain, options = {}) {
  const { maxBlocks = 50_000, holderLimit = 10 } = options;
  // A provider can be injected — the test suite passes an in-process EVM so the
  // whole engine is verifiable without any network access.
  const provider = options.provider || new JsonRpcProvider(chain.rpc, chain.chainId);

  let target;
  try {
    target = getAddress(address);
  } catch {
    throw new Error(`"${address}" is not a valid EVM address.`);
  }

  const report = {
    address: target,
    chain: chain.name,
    chainId: chain.chainId,
    explorer: chain.explorer ? `${chain.explorer}/address/${target}` : null,
    token: {},
    findings: [],
    holders: [],
    checkedAt: new Date().toISOString(),
    incomplete: [],
  };

  // ---- 1. Is there a contract at all? ----
  const code = await provider.getCode(target);
  const size = codeSize(code);
  report.token.codeSize = size;

  if (size === 0) {
    report.findings.push(
      finding(
        "critical",
        "no-code",
        "No contract at this address",
        "This address holds no code. It is a wallet, an unused address, or the token was self-destructed. There is nothing to buy here."
      )
    );
    return report;
  }

  // ---- 2. Does it behave like an ERC-20? ----
  const erc20 = looksLikeERC20(code);
  if (!erc20.isERC20) {
    report.findings.push(
      finding(
        "high",
        "not-erc20",
        "Missing standard ERC-20 functions",
        `Bytecode does not expose: ${erc20.missing.join(", ")}. It may be a proxy, a non-standard token, or not a token at all.`
      )
    );
  }

  // ---- 3. Basic metadata ----
  const token = new Contract(target, ERC20_ABI, provider);
  report.token.name = await attempt(() => token.name(), "(unreadable)");
  report.token.symbol = await attempt(() => token.symbol(), "(unreadable)");
  const decimals = await attempt(() => token.decimals(), 18n);
  report.token.decimals = Number(decimals);
  const totalSupply = await attempt(() => token.totalSupply(), 0n);
  report.token.totalSupply = totalSupply;
  report.token.totalSupplyFormatted = formatUnits(totalSupply, report.token.decimals);

  // ---- 4. Privileged capabilities in the bytecode ----
  const capabilities = scanCapabilities(code);
  report.token.capabilities = capabilities;
  for (const cap of capabilities) {
    if (cap.severity === "info") continue;
    report.findings.push(
      finding(cap.severity, `cap:${cap.sig}`, cap.label, `Exposes \`${cap.sig}\`.`)
    );
  }

  // ---- 5. Self-modifying / self-destructing code ----
  for (const risk of scanDangerousOpcodes(code)) {
    report.findings.push(
      finding(risk.severity, `opcode:${risk.opcode}`, risk.label, `Bytecode contains ${risk.opcode}.`)
    );
  }

  // ---- 6. Upgradeable proxy? Logic can be replaced after you buy. ----
  for (const [label, slot] of Object.entries(PROXY_SLOTS)) {
    const impl = await readAddressSlot(provider, target, slot);
    if (impl) {
      report.token.proxyImplementation = impl;
      report.findings.push(
        finding(
          "high",
          "proxy",
          "Upgradeable proxy detected",
          `Implementation slot (${label}) points at ${impl}. Whoever controls the upgrade can replace this token's logic — including adding a sell block — after you buy.`
        )
      );
      break;
    }
  }

  // ---- 7. Who has the keys? ----
  const ownerContract = new Contract(target, OWNER_ABI, provider);
  const owner =
    (await attempt(() => ownerContract.owner())) ||
    (await attempt(() => ownerContract.getOwner()));

  const hasPrivilegedFns = capabilities.some((c) => c.severity !== "info");

  if (owner) {
    report.token.owner = owner;
    if (BURN_ADDRESSES.has(owner.toLowerCase())) {
      report.findings.push(
        finding(
          "good",
          "ownership-renounced",
          "Ownership renounced",
          `owner() is ${owner} — no wallet can call the owner-only functions any more.`
        )
      );
    } else if (hasPrivilegedFns) {
      report.findings.push(
        finding(
          "critical",
          "live-owner",
          "An active owner holds privileged functions",
          `owner() is ${owner}, and the contract exposes privileged functions. That wallet can change the rules while you hold the token.`
        )
      );
    } else {
      report.findings.push(
        finding(
          "medium",
          "live-owner-benign",
          "Contract has an active owner",
          `owner() is ${owner}. No dangerous functions were detected, so the power appears limited — but the owner is not renounced.`
        )
      );
    }
  } else if (!hasPrivilegedFns) {
    report.findings.push(
      finding(
        "good",
        "no-owner",
        "No owner function found",
        "No owner()/getOwner() and no privileged functions detected — there is no admin to abuse."
      )
    );
  }

  // ---- 8. Holder concentration ----
  const latest = await attempt(() => provider.getBlockNumber(), null);
  if (latest !== null && totalSupply > 0n) {
    const fromBlock = Math.max(0, latest - maxBlocks);
    const { balances, events, complete } = await analyseHolders(provider, target, {
      fromBlock,
      toBlock: latest,
    });

    if (!complete) {
      report.incomplete.push(
        "Holder analysis is partial — the RPC rejected a log range. Numbers below may understate concentration."
      );
    }
    report.token.transferCount = events;
    report.holders = topHolders(balances, totalSupply, holderLimit);

    const top1 = report.holders[0];
    if (top1) {
      // A DEX pool legitimately holds a large share, so this is flagged for
      // review rather than treated as proof of malice.
      if (top1.percent >= 50) {
        report.findings.push(
          finding(
            "critical",
            "concentration",
            `Top holder controls ${top1.percent.toFixed(2)}% of supply`,
            `${top1.address} can crash the price alone. Confirm whether this is the liquidity pool (expected) or a private wallet (dangerous).`
          )
        );
      } else if (top1.percent >= 20) {
        report.findings.push(
          finding(
            "high",
            "concentration",
            `Top holder controls ${top1.percent.toFixed(2)}% of supply`,
            `${top1.address} holds enough to move the price sharply. Check whether it is the pool or a person.`
          )
        );
      }
    }

    if (events === 0) {
      report.findings.push(
        finding(
          "medium",
          "no-transfers",
          "No Transfer events in the scanned range",
          `Nothing moved in the last ${maxBlocks} blocks. The token may be brand new, abandoned, or untradeable.`
        )
      );
    }
  } else {
    report.incomplete.push("Holder analysis skipped — could not read chain height or supply.");
  }

  // ---- 9. What does pons itself say about this launch? ----
  const launch = await readLaunch(provider, chain, target);
  report.launch = launch;

  if (launch.isPonsLaunch) {
    report.findings.push(...launch.findings);
  } else if (!launch.skipReason && chain.pons?.factory) {
    // Neither pons factory deployed this token. That is not automatically bad —
    // it may simply be an ordinary token — but names and images can be copied,
    // so a token presented as a pons launch that no factory knows about is
    // impersonating one.
    report.findings.push(
      finding(
        "medium",
        "not-a-pons-launch",
        "Not deployed by either pons factory",
        "Neither the active nor the legacy pons factory has a record of this token. If you found it presented as a pons launch, the listing is misleading — names, symbols, and images can be copied freely, so always match the contract address."
      )
    );
  }

  // ---- 10. Can you actually get your money back out? ----
  const sim = await simulateRoundTrip(provider, chain, target, {
    probeEth: options.probeEth || "0.01",
    // A pons launch tells us its exact pool and fee tier, so no probing needed.
    knownFee: launch.isPonsLaunch ? launch.poolFee : undefined,
    knownPool: launch.isPonsLaunch ? launch.pool : undefined,
  });
  report.simulation = sim;

  if (sim.skipReason) {
    report.incomplete.push(
      `Honeypot simulation SKIPPED: ${sim.skipReason} Without it, this report cannot tell you whether the token is sellable.`
    );
  }
  report.findings.push(...sim.findings);

  return report;
}

module.exports = { auditToken, analyseHolders, topHolders, ERC20_ABI, BURN_ADDRESSES };
