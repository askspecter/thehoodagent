#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getChain, CHAINS } = require("./lib/chains");
const { auditToken } = require("./lib/audit");
const { scoreReport } = require("./lib/score");

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const SEVERITY_STYLE = {
  critical: { color: COLORS.red, mark: "✖", label: "CRITICAL" },
  high: { color: COLORS.red, mark: "▲", label: "HIGH" },
  medium: { color: COLORS.yellow, mark: "▲", label: "MEDIUM" },
  low: { color: COLORS.yellow, mark: "•", label: "LOW" },
  info: { color: COLORS.dim, mark: "·", label: "INFO" },
  good: { color: COLORS.green, mark: "✔", label: "GOOD" },
};

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "good", "info"];

function color(text, c) {
  return process.stdout.isTTY ? `${c}${text}${COLORS.reset}` : text;
}

function usage() {
  console.log(`
${color("pons-sentinel", COLORS.bold)} — read-only token auditor

USAGE
  node agent/cli.js audit <token-address> [--network <name>] [--blocks <n>] [--json]
  node agent/cli.js networks

OPTIONS
  --network <name>   Network key. Default: robinhood
  --blocks <n>       How many recent blocks to replay for holders. Default: 50000
  --json             Machine-readable output

EXAMPLES
  node agent/cli.js audit 0xYourToken --network robinhood
  node agent/cli.js audit 0xYourToken --network local --blocks 5000 --json

This command only reads the chain. It never sends a transaction, never needs a
private key, and cannot spend anything.
`);
}

function parseArgs(argv) {
  const args = { _: [], network: "robinhood", blocks: 50_000, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--network") args.network = argv[++i];
    else if (arg === "--blocks") args.blocks = Number(argv[++i]);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else args._.push(arg);
  }
  return args;
}

function printReport(report) {
  const scored = scoreReport(report);
  const t = report.token;

  console.log("");
  console.log(color("═".repeat(68), COLORS.dim));
  console.log(
    `${color("TOKEN", COLORS.bold)}  ${t.name} (${t.symbol})   ${color(report.address, COLORS.cyan)}`
  );
  console.log(`${color("CHAIN", COLORS.bold)}  ${report.chain} (${report.chainId})`);
  if (t.totalSupplyFormatted) {
    console.log(`${color("SUPPLY", COLORS.bold)} ${t.totalSupplyFormatted} ${t.symbol}`);
  }
  if (report.explorer) console.log(`${color("LINK", COLORS.bold)}   ${report.explorer}`);
  console.log(color("═".repeat(68), COLORS.dim));

  const verdictColor =
    scored.score >= 60 ? COLORS.red : scored.score >= 35 ? COLORS.red : scored.score >= 15 ? COLORS.yellow : COLORS.green;

  console.log("");
  console.log(
    `  ${color(`RISK ${scored.score}/100 — ${scored.verdict}`, COLORS.bold + verdictColor)}`
  );
  console.log(`  ${color(scored.blurb, COLORS.dim)}`);
  if (scored.confidence === "partial") {
    console.log(
      `  ${color("⚠ PARTIAL AUDIT — some checks did not run. See NOT CHECKED below.", COLORS.yellow)}`
    );
  }

  console.log("");
  console.log(color("FINDINGS", COLORS.bold));
  if (report.findings.length === 0) {
    console.log("  (none)");
  } else {
    const sorted = [...report.findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    );
    for (const f of sorted) {
      const style = SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.info;
      console.log(
        `  ${color(style.mark, style.color)} ${color(style.label.padEnd(8), style.color)} ${f.title}`
      );
      console.log(`    ${color(f.detail, COLORS.dim)}`);
    }
  }

  if (report.holders.length > 0) {
    console.log("");
    console.log(color(`TOP HOLDERS  ${color(`(${t.transferCount ?? 0} transfers seen)`, COLORS.dim)}`, COLORS.bold));
    for (const h of report.holders) {
      const bar = "█".repeat(Math.max(1, Math.round(h.percent / 4)));
      console.log(
        `  ${h.percent.toFixed(2).padStart(6)}%  ${color(bar, COLORS.magenta)} ${color(h.address, COLORS.dim)}`
      );
    }
  }

  if (report.incomplete.length > 0) {
    console.log("");
    console.log(color("NOT CHECKED", COLORS.bold + COLORS.yellow));
    for (const note of report.incomplete) console.log(`  ${color("!", COLORS.yellow)} ${note}`);
  }

  console.log("");
  console.log(
    color(
      "This is an automated heuristic scan, not a guarantee. A clean report does\n" +
        "not mean a token will hold value — most launchpad tokens go to zero.",
      COLORS.dim
    )
  );
  console.log("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (args.help || !command) return usage();

  if (command === "networks") {
    console.log("");
    for (const [key, chain] of Object.entries(CHAINS)) {
      const router = chain.pons?.router ? "router set" : color("no router configured", COLORS.yellow);
      console.log(`  ${color(key.padEnd(18), COLORS.cyan)} ${chain.name} (${chain.chainId})  ${router}`);
    }
    console.log("");
    return;
  }

  if (command !== "audit") {
    console.error(`Unknown command "${command}".`);
    usage();
    process.exitCode = 1;
    return;
  }

  const address = args._[1];
  if (!address) {
    console.error("Missing token address.\n");
    usage();
    process.exitCode = 1;
    return;
  }

  const chain = getChain(args.network);
  if (!args.json) {
    console.error(color(`Auditing ${address} on ${chain.name}…`, COLORS.dim));
  }

  const report = await auditToken(address, chain, { maxBlocks: args.blocks });

  if (args.json) {
    const scored = scoreReport(report);
    // BigInt is not JSON-serialisable, so stringify it explicitly.
    console.log(
      JSON.stringify({ ...report, score: scored }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)
    );
  } else {
    printReport(report);
  }
}

main().catch((error) => {
  console.error(`\n${color("Audit failed:", COLORS.red)} ${error.message}`);
  if (/fetch|network|ECONN|timeout/i.test(error.message)) {
    console.error(
      color(
        "\nThis usually means the RPC is unreachable. Check your --network and RPC URL.\n" +
          "Note: some sandboxed environments block outbound RPC entirely.",
        COLORS.dim
      )
    );
  }
  process.exitCode = 1;
});
