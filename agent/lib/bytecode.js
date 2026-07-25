"use strict";

const { DANGEROUS_TABLE, ERC20_FUNCTIONS, selectorOf } = require("./selectors");

/** Storage slots used by the common upgradeable-proxy standards. */
const PROXY_SLOTS = {
  // EIP-1967 implementation slot
  eip1967Implementation:
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  // EIP-1967 beacon slot
  eip1967Beacon:
    "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  // OpenZeppelin legacy (pre-1967) implementation slot
  ozLegacyImplementation:
    "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
};

const OPCODES = {
  0x55: "SSTORE",
  0xf1: "CALL",
  0xf2: "CALLCODE",
  0xf4: "DELEGATECALL",
  0xfa: "STATICCALL",
  0xff: "SELFDESTRUCT",
};

function normalizeCode(bytecode) {
  if (typeof bytecode !== "string") return "";
  return bytecode.startsWith("0x") || bytecode.startsWith("0X")
    ? bytecode.slice(2).toLowerCase()
    : bytecode.toLowerCase();
}

/**
 * Walk EVM bytecode one instruction at a time.
 *
 * This matters for correctness: a naive substring search for a selector can
 * match bytes that are really PUSH *data* (a string constant, a hash), which
 * produces false accusations. Walking the instruction stream and only reading
 * genuine PUSH4 immediates avoids that, and it also lets us detect opcodes like
 * SELFDESTRUCT without tripping over an 0xff byte that is just data.
 *
 * @returns {{push4: Set<string>, opcodes: Set<string>, instructionCount: number}}
 */
function walk(bytecode) {
  const code = normalizeCode(bytecode);
  const push4 = new Set();
  const opcodes = new Set();
  let instructionCount = 0;

  // Two hex characters per byte.
  for (let i = 0; i + 1 < code.length; ) {
    const op = parseInt(code.slice(i, i + 2), 16);
    if (Number.isNaN(op)) break;
    instructionCount += 1;

    if (OPCODES[op]) opcodes.add(OPCODES[op]);

    // PUSH1 (0x60) .. PUSH32 (0x7f) carry an inline immediate we must skip.
    if (op >= 0x60 && op <= 0x7f) {
      const immediateBytes = op - 0x5f;
      const start = i + 2;
      const end = start + immediateBytes * 2;
      if (op === 0x63 && end <= code.length) {
        // PUSH4 — candidate function selector from the dispatcher.
        push4.add("0x" + code.slice(start, end));
      }
      i = end;
      continue;
    }

    i += 2;
  }

  return { push4, opcodes, instructionCount };
}

/**
 * Which privileged capabilities does this deployed contract expose?
 * @returns {Array<{sig,label,severity,selector}>}
 */
function scanCapabilities(bytecode) {
  const { push4 } = walk(bytecode);
  return DANGEROUS_TABLE.filter((entry) => push4.has(entry.selector));
}

/** Does the bytecode expose the core ERC-20 surface? */
function looksLikeERC20(bytecode) {
  const { push4 } = walk(bytecode);
  const missing = ERC20_FUNCTIONS.filter((sig) => !push4.has(selectorOf(sig)));
  return { isERC20: missing.length === 0, missing };
}

/** Opcodes that let a contract change or destroy itself. */
function scanDangerousOpcodes(bytecode) {
  const { opcodes } = walk(bytecode);
  const found = [];
  if (opcodes.has("SELFDESTRUCT")) {
    found.push({
      opcode: "SELFDESTRUCT",
      label: "Contract can destroy itself",
      severity: "critical",
    });
  }
  if (opcodes.has("DELEGATECALL")) {
    found.push({
      opcode: "DELEGATECALL",
      label: "Contract delegates logic elsewhere (behaviour can change)",
      severity: "high",
    });
  }
  return found;
}

/** Byte length of the deployed code. 0 means there is no contract there. */
function codeSize(bytecode) {
  return normalizeCode(bytecode).length / 2;
}

module.exports = {
  PROXY_SLOTS,
  walk,
  scanCapabilities,
  looksLikeERC20,
  scanDangerousOpcodes,
  codeSize,
  normalizeCode,
};
