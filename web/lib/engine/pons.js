"use strict";

const { Contract, ZeroAddress, formatEther, formatUnits } = require("ethers");

/**
 * Reads pons launch state directly off the contracts.
 *
 * Everything here is authoritative on-chain data — no off-chain index, no API.
 * pons launch tokens are self-describing: the token itself knows its logo,
 * description, socials, and canonical pool, and the factory that deployed it
 * holds the launch parameters.
 *
 * Knowing the launch parameters makes the rest of the audit sharper:
 *   • `liquidityPool()` gives the exact pool, so we never guess a fee tier.
 *   • `isToken0` is required to price the pool correctly.
 *   • `restrictionsEndBlock` tells us whether launch protection is still active.
 *   • `graduationStatus` gives real progress toward the WETH threshold.
 */

const TOKEN_ABI = [
  "function logo() view returns (string)",
  "function description() view returns (string)",
  "function liquidityPool() view returns (address)",
  "function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)",
];

const FACTORY_ABI = [
  "function getLaunchedToken(address token) view returns ((address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 dexId, uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount) launched)",
  "function graduationStatus(address token) view returns (uint256 pairedPrincipal, uint256 threshold, bool graduated)",
  "function locker() view returns (address)",
];

const LOCKER_ABI = [
  "function tokenProtocolFeeShares(address token) view returns (uint256)",
  "function feeRedirects(address token) view returns (address)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

async function attempt(factory, fallback = null) {
  try {
    return await factory();
  } catch {
    return fallback;
  }
}

/**
 * Find which pons factory deployed this token.
 *
 * A token may come from the active factory or the legacy one, and the fee split
 * differs between them (70/30 vs 90/10), so we must not assume.
 */
async function resolveFactory(provider, chain, token) {
  const candidates = [
    { address: chain.pons?.factory, generation: "active", defaultCreatorShare: 70 },
    { address: chain.pons?.legacyFactory, generation: "legacy", defaultCreatorShare: 90 },
  ].filter((c) => c.address);

  for (const candidate of candidates) {
    const factory = new Contract(candidate.address, FACTORY_ABI, provider);
    const result = await attempt(() => factory.getLaunchedToken(token));
    // `exists` is the authoritative signal that this factory created the token.
    if (result && result.exists) {
      return { ...candidate, launched: result, contract: factory };
    }
  }
  return null;
}

/** Convert a pool's sqrtPriceX96 into a token price denominated in WETH. */
function priceFromSqrt(sqrtPriceX96, isToken0) {
  // Both the launch token and WETH use 18 decimals, so no scaling is needed.
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const token1PerToken0 = ratio * ratio;
  if (!Number.isFinite(token1PerToken0) || token1PerToken0 === 0) return null;
  return isToken0 ? token1PerToken0 : 1 / token1PerToken0;
}

/**
 * Gather everything pons knows about a launch.
 *
 * Returns `{ isPonsLaunch: false }` for any token pons did not deploy — which is
 * itself worth reporting, since a token that merely *claims* to be a pons launch
 * but is absent from both factories is impersonating one.
 */
async function readLaunch(provider, chain, token) {
  if (!chain.pons?.factory) {
    return { isPonsLaunch: false, skipReason: "No pons factory configured for this network." };
  }

  const resolved = await resolveFactory(provider, chain, token);
  if (!resolved) {
    return { isPonsLaunch: false };
  }

  const { launched, generation, defaultCreatorShare, contract: factory } = resolved;
  const out = {
    isPonsLaunch: true,
    generation,
    deployer: launched.deployer,
    pairedToken: launched.pairedToken,
    poolFee: Number(launched.poolFee),
    isToken0: launched.isToken0,
    supply: launched.supply,
    restrictionsEndBlock: Number(launched.restrictionsEndBlock),
    initialBuyAmount: launched.initialBuyAmount,
    findings: [],
  };

  // The token knows its own canonical pool; prefer that over deriving it.
  const tokenContract = new Contract(token, TOKEN_ABI, provider);
  out.pool = await attempt(() => tokenContract.liquidityPool(), null);
  out.logo = await attempt(() => tokenContract.logo(), null);
  out.description = await attempt(() => tokenContract.description(), null);

  const socials = await attempt(() => tokenContract.socials(), null);
  if (socials) {
    out.socials = {
      twitter: socials.twitter || socials[0] || "",
      telegram: socials.telegram || socials[1] || "",
      discord: socials.discord || socials[2] || "",
      website: socials.website || socials[3] || "",
      farcaster: socials.farcaster || socials[4] || "",
    };
  }

  // ---- Graduation ----
  const graduation = await attempt(() => factory.graduationStatus(token), null);
  if (graduation) {
    const [pairedPrincipal, threshold, graduated] = graduation;
    out.graduation = {
      pairedEth: formatEther(pairedPrincipal),
      thresholdEth: formatEther(threshold),
      graduated,
      progress: threshold > 0n ? Number((pairedPrincipal * 10_000n) / threshold) / 10_000 : 0,
    };

    // Graduation is a threshold, not a quality signal — say so explicitly,
    // because it is widely misread as a safety badge.
    out.findings.push({
      severity: "info",
      id: "graduation",
      title: graduated
        ? `Graduated (${out.graduation.pairedEth} / ${out.graduation.thresholdEth} ETH paired)`
        : `Not graduated — ${(out.graduation.progress * 100).toFixed(1)}% of the ${out.graduation.thresholdEth} ETH threshold`,
      detail:
        "Graduation only confirms the paired-WETH threshold was reached. It is not an audit, an endorsement, or a guarantee of liquidity or an exit. Trading continues in the same pool either way.",
    });
  }

  // ---- Launch protection window ----
  const currentBlock = await attempt(() => provider.getBlockNumber(), null);
  if (currentBlock !== null && out.restrictionsEndBlock > 0) {
    out.protectionActive = currentBlock <= out.restrictionsEndBlock;
    if (out.protectionActive) {
      out.findings.push({
        severity: "info",
        id: "launch-protection",
        title: `Launch protection active until block ${out.restrictionsEndBlock}`,
        detail: `Currently block ${currentBlock}. During this window each wallet may hold at most 5% and buy at most 5.5% of supply. Selling and transfers are never restricted, and the limits end when the window closes.`,
      });
    }
  }

  // ---- Fee split ----
  const lockerAddress = await attempt(() => factory.locker(), null);
  if (lockerAddress) {
    const locker = new Contract(lockerAddress, LOCKER_ABI, provider);
    const protocolShare = await attempt(() => locker.tokenProtocolFeeShares(token), null);
    const redirect = await attempt(() => locker.feeRedirects(token), null);
    out.fees = {
      locker: lockerAddress,
      protocolSharePercent: protocolShare !== null ? Number(protocolShare) : null,
      creatorSharePercent: protocolShare !== null ? 100 - Number(protocolShare) : defaultCreatorShare,
      creatorPayout: redirect && redirect !== ZeroAddress ? redirect : launched.deployer,
      // A redirect means the creator payout was reassigned — normal after a
      // community takeover, but worth surfacing rather than hiding.
      redirected: Boolean(redirect && redirect !== ZeroAddress),
    };
  }

  // ---- Live pool price ----
  if (out.pool && out.pool !== ZeroAddress) {
    const pool = new Contract(out.pool, POOL_ABI, provider);
    const slot0 = await attempt(() => pool.slot0(), null);
    if (slot0) {
      const priceInWeth = priceFromSqrt(slot0[0], out.isToken0);
      if (priceInWeth !== null) {
        out.priceInWeth = priceInWeth;
        const supplyTokens = Number(formatUnits(out.supply, 18));
        // Supply is fixed, so FDV equals market cap unless tokens were burned.
        out.marketCapWeth = priceInWeth * supplyTokens;
      }
    }
  }

  return out;
}

module.exports = {
  readLaunch,
  resolveFactory,
  priceFromSqrt,
  TOKEN_ABI,
  FACTORY_ABI,
  LOCKER_ABI,
  POOL_ABI,
};
