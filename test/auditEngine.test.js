const { expect } = require("chai");
const { ethers } = require("hardhat");

const { auditToken } = require("../lib/engine/audit");
const { scoreFindings, scoreReport } = require("../lib/engine/score");
const {
  scanCapabilities,
  looksLikeERC20,
  walk,
  codeSize,
} = require("../lib/engine/bytecode");
const { selectorOf } = require("../lib/engine/selectors");
const { getChain } = require("../lib/engine/chains");
const { priceFromSqrt, readLaunch } = require("../lib/engine/pons");

/**
 * These tests run the audit engine against contracts deployed to an in-process
 * EVM, so the detector is verified against real bytecode rather than fixtures
 * we wrote by hand. `local` has no quoter configured, so the honeypot
 * simulation is expected to report itself as skipped — which we also assert,
 * because silently skipping a safety check is the dangerous failure mode.
 */
describe("audit engine", function () {
  let owner, alice;
  let cleanToken, maliciousToken;
  const chain = { ...getChain("local") };

  before(async function () {
    [owner, alice] = await ethers.getSigners();

    const Clean = await ethers.getContractFactory("PonsFamilyToken");
    cleanToken = await Clean.deploy(owner.address);
    await cleanToken.waitForDeployment();

    const Malicious = await ethers.getContractFactory("MaliciousToken");
    maliciousToken = await Malicious.deploy(owner.address);
    await maliciousToken.waitForDeployment();
  });

  const audit = (address) =>
    auditToken(address, chain, { provider: ethers.provider, maxBlocks: 5_000 });

  describe("bytecode scanner", function () {
    it("computes known ERC-20 selectors correctly", function () {
      // Well-known values — if these drift, every scan result is wrong.
      expect(selectorOf("transfer(address,uint256)")).to.equal("0xa9059cbb");
      expect(selectorOf("balanceOf(address)")).to.equal("0x70a08231");
      expect(selectorOf("totalSupply()")).to.equal("0x18160ddd");
    });

    it("does not mistake PUSH data for a function selector", function () {
      // PUSH32 whose immediate contains the bytes of transfer()'s selector.
      // A naive substring search would report a match here; the walker must not.
      const fake = "0x7f" + "a9059cbb".padEnd(64, "0");
      const { push4 } = walk(fake);
      expect(push4.has("0xa9059cbb")).to.equal(false);
    });

    it("recognises a real ERC-20 surface", async function () {
      const code = await ethers.provider.getCode(await cleanToken.getAddress());
      expect(looksLikeERC20(code).isERC20).to.equal(true);
      expect(codeSize(code)).to.be.greaterThan(0);
    });

    it("finds every planted dangerous capability in the malicious token", async function () {
      const code = await ethers.provider.getCode(await maliciousToken.getAddress());
      const found = scanCapabilities(code).map((c) => c.sig);

      expect(found).to.include("mint(address,uint256)");
      expect(found).to.include("blacklist(address)");
      expect(found).to.include("pause()");
      expect(found).to.include("setFee(uint256)");
      expect(found).to.include("setMaxTxAmount(uint256)");
    });

    it("finds no dangerous capabilities in the clean token", async function () {
      const code = await ethers.provider.getCode(await cleanToken.getAddress());
      const dangerous = scanCapabilities(code).filter((c) => c.severity !== "info");
      expect(dangerous).to.deep.equal([]);
    });
  });

  describe("full report", function () {
    it("scores the malicious token as AVOID and names the reasons", async function () {
      const report = await audit(await maliciousToken.getAddress());
      const score = scoreReport(report);

      expect(score.verdict).to.equal("AVOID");
      expect(score.score).to.be.greaterThanOrEqual(60);

      const ids = report.findings.map((f) => f.id);
      expect(ids).to.include("cap:mint(address,uint256)");
      expect(ids).to.include("cap:blacklist(address)");
      // The owner is live AND holds privileged functions — the worst combination.
      expect(ids).to.include("live-owner");
      expect(report.token.symbol).to.equal("RUG");
    });

    it("scores the clean fixed-supply token far lower", async function () {
      const report = await audit(await cleanToken.getAddress());
      const score = scoreReport(report);

      expect(report.token.symbol).to.equal("PONS");
      // No owner and no privileged functions should be credited as good.
      expect(report.findings.map((f) => f.id)).to.include("no-owner");
      expect(score.score).to.be.lessThan(35);
    });

    it("ranks the malicious token strictly riskier than the clean one", async function () {
      const bad = scoreReport(await audit(await maliciousToken.getAddress()));
      const good = scoreReport(await audit(await cleanToken.getAddress()));
      expect(bad.score).to.be.greaterThan(good.score);
    });

    it("reports an address with no contract instead of guessing", async function () {
      const report = await audit(alice.address);
      expect(report.findings.map((f) => f.id)).to.include("no-code");
    });

    it("rejects a malformed address", async function () {
      await expect(audit("not-an-address")).to.be.rejectedWith(/not a valid EVM address/);
    });

    it("computes holder concentration from Transfer events", async function () {
      const token = cleanToken.connect(owner);
      await token.transfer(alice.address, ethers.parseUnits("250000000", 18)); // 25%

      const report = await audit(await cleanToken.getAddress());
      const aliceRow = report.holders.find(
        (h) => h.address.toLowerCase() === alice.address.toLowerCase()
      );

      expect(aliceRow, "alice should appear as a holder").to.not.equal(undefined);
      expect(aliceRow.percent).to.be.closeTo(25, 0.01);
      // 25% in one wallet is worth flagging.
      expect(report.findings.map((f) => f.id)).to.include("concentration");
    });

    it("declares the honeypot simulation as skipped rather than passing silently", async function () {
      const report = await audit(await cleanToken.getAddress());

      expect(report.simulation.skipReason).to.be.a("string");
      expect(report.incomplete.join(" ")).to.match(/simulation SKIPPED/i);
      // A skipped safety check must reduce stated confidence.
      expect(scoreReport(report).confidence).to.equal("partial");
    });
  });

  describe("pons pool pricing", function () {
    // Getting sqrtPriceX96 wrong silently produces plausible-looking but wrong
    // prices and market caps, so the maths is pinned down here.
    const Q96 = 2 ** 96;

    it("prices a 1:1 pool as 1 in both token orderings", function () {
      expect(priceFromSqrt(BigInt(Q96), true)).to.be.closeTo(1, 1e-9);
      expect(priceFromSqrt(BigInt(Q96), false)).to.be.closeTo(1, 1e-9);
    });

    it("squares the sqrt ratio", function () {
      // sqrtPrice = 2 → token1 per token0 = 4
      expect(priceFromSqrt(BigInt(Q96 * 2), true)).to.be.closeTo(4, 1e-6);
    });

    it("inverts the price when the token is not token0", function () {
      // Same pool read from the other side must be the reciprocal.
      expect(priceFromSqrt(BigInt(Q96 * 2), false)).to.be.closeTo(0.25, 1e-6);
    });

    it("returns null rather than Infinity for a zero price", function () {
      expect(priceFromSqrt(0n, true)).to.equal(null);
      expect(priceFromSqrt(0n, false)).to.equal(null);
    });
  });

  describe("pons launch detection", function () {
    it("reports a non-pons token as not a launch instead of inventing data", async function () {
      // The `local` chain has no pons factory, so this must degrade cleanly.
      const launch = await readLaunch(ethers.provider, chain, await cleanToken.getAddress());
      expect(launch.isPonsLaunch).to.equal(false);
      expect(launch.skipReason).to.be.a("string");
    });

    it("does not flag impersonation when no pons factory is configured", async function () {
      // Without a factory to ask, claiming "not a pons launch" would be a
      // conclusion drawn from a check that never ran.
      const report = await audit(await cleanToken.getAddress());
      expect(report.findings.map((f) => f.id)).to.not.include("not-a-pons-launch");
    });
  });

  describe("scoring", function () {
    it("weights critical findings above medium ones", function () {
      const critical = scoreFindings([{ severity: "critical" }]).score;
      const medium = scoreFindings([{ severity: "medium" }]).score;
      expect(critical).to.be.greaterThan(medium);
    });

    it("credits good findings by lowering the score", function () {
      const withGood = scoreFindings([{ severity: "medium" }, { severity: "good" }]).score;
      const withoutGood = scoreFindings([{ severity: "medium" }]).score;
      expect(withGood).to.be.lessThan(withoutGood);
    });

    it("clamps the score to 0..100", function () {
      const many = Array.from({ length: 20 }, () => ({ severity: "critical" }));
      expect(scoreFindings(many).score).to.equal(100);
      expect(scoreFindings([{ severity: "good" }]).score).to.equal(0);
    });
  });
});
