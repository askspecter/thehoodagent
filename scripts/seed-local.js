/**
 * Seed a local EVM with fixture tokens so the web UI has something real to audit
 * without touching a live network.
 *
 * Usage:
 *   npx hardhat node                                  # terminal 1
 *   npx hardhat run scripts/seed-local.js --network localhost   # terminal 2
 *
 * Then in the web app pick network "Local EVM" and paste one of the printed
 * addresses. The MaliciousToken should come back as AVOID; the clean $PONS
 * should score low.
 */
const hre = require("hardhat");

async function main() {
  const [owner, alice] = await hre.ethers.getSigners();

  const Malicious = await hre.ethers.getContractFactory("MaliciousToken");
  const bad = await Malicious.deploy(owner.address);
  await bad.waitForDeployment();
  // Move a chunk to a second wallet so holder concentration has more than one bar.
  await (await bad.transfer(alice.address, hre.ethers.parseUnits("300000000", 18))).wait();

  const Clean = await hre.ethers.getContractFactory("PonsFamilyToken");
  const good = await Clean.deploy(owner.address);
  await good.waitForDeployment();
  await (await good.transfer(alice.address, hre.ethers.parseUnits("120000000", 18))).wait();

  console.log("");
  console.log("MALICIOUS (expect AVOID):", await bad.getAddress());
  console.log("CLEAN     (expect low)  :", await good.getAddress());
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
