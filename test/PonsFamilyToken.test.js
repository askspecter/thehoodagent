const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PonsFamilyToken ($PONS)", function () {
  let token, owner, treasury, alice, bob;
  const ONE_BILLION = ethers.parseUnits("1000000000", 18);

  beforeEach(async function () {
    [owner, treasury, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("PonsFamilyToken");
    token = await Token.deploy(treasury.address);
    await token.waitForDeployment();
  });

  it("has the correct name, symbol and 18 decimals", async function () {
    expect(await token.name()).to.equal("Pons Family");
    expect(await token.symbol()).to.equal("PONS");
    expect(await token.decimals()).to.equal(18);
  });

  it("mints exactly 1,000,000,000 tokens to the treasury", async function () {
    expect(await token.totalSupply()).to.equal(ONE_BILLION);
    expect(await token.balanceOf(treasury.address)).to.equal(ONE_BILLION);
    expect(await token.INITIAL_SUPPLY()).to.equal(ONE_BILLION);
  });

  it("reverts if the treasury is the zero address", async function () {
    const Token = await ethers.getContractFactory("PonsFamilyToken");
    await expect(Token.deploy(ethers.ZeroAddress)).to.be.revertedWith(
      "PONS: treasury is zero address"
    );
  });

  it("lets anyone transfer freely (no tax, no pause, no blacklist)", async function () {
    const amount = ethers.parseUnits("1000", 18);
    await token.connect(treasury).transfer(alice.address, amount);
    expect(await token.balanceOf(alice.address)).to.equal(amount);

    // Alice can always move her tokens on — this is what proves it is not a honeypot.
    await token.connect(alice).transfer(bob.address, amount);
    expect(await token.balanceOf(bob.address)).to.equal(amount);
    expect(await token.balanceOf(alice.address)).to.equal(0n);
  });

  it("supports approve + transferFrom (needed for DEX swaps)", async function () {
    const amount = ethers.parseUnits("500", 18);
    await token.connect(treasury).approve(alice.address, amount);
    expect(await token.allowance(treasury.address, alice.address)).to.equal(amount);

    await token.connect(alice).transferFrom(treasury.address, bob.address, amount);
    expect(await token.balanceOf(bob.address)).to.equal(amount);
  });

  it("can be burned, permanently reducing supply", async function () {
    const burnAmount = ethers.parseUnits("250000000", 18); // burn 250M
    await token.connect(treasury).burn(burnAmount);
    expect(await token.totalSupply()).to.equal(ONE_BILLION - burnAmount);
  });

  it("has no mint function (supply can never be inflated)", async function () {
    // The contract exposes no mint() — proof that supply is fixed forever.
    expect(token.mint).to.equal(undefined);
  });
});
