"use strict";

/**
 * Turn a list of findings into a single risk score.
 *
 * The weights are deliberately harsh on anything that can stop you from
 * selling or can inflate supply, because those are the two failure modes that
 * take a buyer to zero. `good` findings subtract, so a renounced-ownership
 * token scores better than an identical one with a live owner.
 */
const WEIGHTS = {
  critical: 40,
  high: 18,
  medium: 7,
  low: 3,
  info: 0,
  good: -8,
};

const BANDS = [
  { max: 14, verdict: "LOW RISK", blurb: "No serious control surfaces found." },
  { max: 34, verdict: "CAUTION", blurb: "Some centralised control. Read the findings." },
  { max: 59, verdict: "HIGH RISK", blurb: "Meaningful power over holders exists." },
  { max: Infinity, verdict: "AVOID", blurb: "Holder funds can be trapped or diluted." },
];

function scoreFindings(findings) {
  let score = 0;
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, good: 0 };

  for (const f of findings) {
    const weight = WEIGHTS[f.severity] ?? 0;
    score += weight;
    if (counts[f.severity] !== undefined) counts[f.severity] += 1;
  }

  score = Math.max(0, Math.min(100, score));
  const band = BANDS.find((b) => score <= b.max);

  return { score, verdict: band.verdict, blurb: band.blurb, counts };
}

/**
 * A score is only as good as the checks that ran. If the honeypot/liquidity
 * checks were skipped, say so loudly rather than letting a low score read as
 * "safe to buy".
 */
function scoreReport(report) {
  const result = scoreFindings(report.findings);
  result.confidence = report.incomplete.length === 0 ? "full" : "partial";
  return result;
}

module.exports = { scoreFindings, scoreReport, WEIGHTS, BANDS };
