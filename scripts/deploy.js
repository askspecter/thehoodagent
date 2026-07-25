const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  if (!deployer) {
    throw new Error(
      "No deployer account found. Add PRIVATE_KEY to your .env file (copy .env.example)."
    );
  }

  const network = hre.network.name;
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("────────────────────────────────────────────");
  console.log("Deploying Pons Family Token ($PONS)");
  console.log("Network :", network);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", hre.ethers.formatEther(balance), "(native gas coin)");
  console.log("────────────────────────────────────────────");

  // The treasury receives the full 1,000,000,000 PONS supply.
  // Defaults to the deployer; override with TREASURY_ADDRESS in .env.
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;

  const Token = await hre.ethers.getContractFactory("PonsFamilyToken");
  const token = await Token.deploy(treasury);
  await token.waitForDeployment();

  const address = await token.getAddress();
  const supply = await token.totalSupply();

  console.log("");
  console.log("✅ $PONS deployed!");
  console.log("Contract address:", address);
  console.log("Treasury (holds supply):", treasury);
  console.log("Total supply:", hre.ethers.formatUnits(supply, 18), "PONS");
  console.log("");
  console.log("NEXT STEPS:");
  console.log("  1. Paste this address into website/config.js -> CONTRACT_ADDRESS");
  console.log("  2. Verify the contract on the block explorer (see README).");
  console.log("  3. Create a liquidity pool on a DEX to make it tradeable.");
  console.log("  4. Lock or burn the LP tokens, then announce.");
  console.log("────────────────────────────────────────────");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
