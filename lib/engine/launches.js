"use strict";

const { Contract, formatUnits, id, getAddress } = require("ethers");
const { readLaunch } = require("./pons");

/**
 * The launchpad feed: every token deployed through the pons factory.
 *
 * Because launches are deployed by the pons factory, a token created here also
 * appears on ponsfamily.com — same factory, same pool, same chain. There is no
 * separate registry to sync; the factory's own `TokenLaunched` event IS the
 * index, which is why this reads it directly rather than trusting any API.
 *
 * Two constraints shape the implementation:
 *
 *  1. The pons docs warn the public RPC times out on wide `eth_getLogs` ranges,
 *     so the scan is chunked and only covers a recent window by default.
 *  2. Enriching a token (metadata + graduation + pool price) costs several RPC
 *     calls each, so only the newest `limit` launches are enriched. Listing
 *     50,000+ tokens on every page load is not a thing a web request can do.
 */

const TOKEN_LAUNCHED_SIG =
  "TokenLaunched(address,address,address,address,address,uint256,uint256,uint256,uint256,uint256)";

/** Documented topic0. Computed here too, so a mismatch fails loudly in tests. */
const TOKEN_LAUNCHED_TOPIC = id(TOKEN_LAUNCHED_SIG);

const FACTORY_EVENT_ABI = [
  "event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)",
];

const ERC20_META_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

/** In-memory cache. Resets on cold start; swap for Redis for real traffic. */
const cache = new Map();
const CACHE_TTL_MS = 30_000;

function cacheKey(chainKey, maxBlocks, limit) {
  return `${chainKey}:${maxBlocks}:${limit}`;
}

/**
 * Scan `TokenLaunched` logs in bounded chunks, newest chunk first is not
 * possible with getLogs, so we collect then reverse.
 */
async function scanLaunchLogs(provider, factoryAddress, { fromBlock, toBlock, chunkSize }) {
  const factory = new Contract(factoryAddress, FACTORY_EVENT_ABI, provider);
  const filter = factory.filters.TokenLaunched();
  const events = [];
  let truncated = false;

  // Walk backwards from the head so a partial scan still returns the newest
  // launches, which are the ones anyone actually wants to see.
  for (let end = toBlock; end >= fromBlock; end -= chunkSize) {
    const start = Math.max(fromBlock, end - chunkSize + 1);
    let logs;
    try {
      logs = await factory.queryFilter(filter, start, end);
    } catch {
      // Range rejected or timed out — stop and report what we have.
      truncated = true;
      break;
    }
    // Within a chunk, later logs are newer.
    for (let i = logs.length - 1; i >= 0; i -= 1) events.push(logs[i]);
  }

  return { events, truncated };
}

/** Turn one log into the shape the UI needs, before enrichment. */
function baseLaunch(log) {
  const a = log.args;
  return {
    token: getAddress(a.token),
    deployer: getAddress(a.deployer),
    pairToken: getAddress(a.pairToken),
    pool: getAddress(a.pool),
    restrictionsEndBlock: Number(a.restrictionsEndBlock),
    initialBuyAmount: a.initialBuyAmount,
    blockNumber: log.blockNumber,
    txHash: log.transactionHash,
  };
}

/**
 * List launches, newest first, with the newest `limit` enriched with live state.
 *
 * @returns {{launches: Array, stats: object, truncated: boolean, note: string|null}}
 */
async function listLaunches(provider, chain, options = {}) {
  const {
    maxBlocks = 60_000,
    limit = 12,
    chunkSize = 2_000,
    useCache = true,
  } = options;

  const factoryAddress = chain.pons?.factory;
  if (!factoryAddress) {
    return {
      launches: [],
      stats: null,
      truncated: false,
      note: "No pons factory is configured for this network, so there are no launches to list.",
    };
  }

  const key = cacheKey(chain.key, maxBlocks, limit);
  if (useCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  }

  const head = await provider.getBlockNumber();
  const startBlock = chain.pons.factoryStartBlock || 0;
  const fromBlock = Math.max(startBlock, head - maxBlocks);

  const { events, truncated } = await scanLaunchLogs(provider, factoryAddress, {
    fromBlock,
    toBlock: head,
    chunkSize,
  });

  const all = events.map(baseLaunch);
  const enrichTargets = all.slice(0, limit);

  const enriched = await Promise.all(
    enrichTargets.map(async (base) => {
      const out = { ...base };
      try {
        const meta = new Contract(base.token, ERC20_META_ABI, provider);
        const [name, symbol] = await Promise.all([
          meta.name().catch(() => null),
          meta.symbol().catch(() => null),
        ]);
        out.name = name;
        out.symbol = symbol;

        const launch = await readLaunch(provider, chain, base.token);
        if (launch.isPonsLaunch) {
          out.logo = launch.logo || null;
          out.description = launch.description || null;
          out.socials = launch.socials || null;
          out.priceInWeth = launch.priceInWeth ?? null;
          out.marketCapWeth = launch.marketCapWeth ?? null;
          out.graduated = launch.graduation?.graduated ?? null;
          out.graduationProgress = launch.graduation?.progress ?? null;
          out.pairedEth = launch.graduation?.pairedEth ?? null;
          out.thresholdEth = launch.graduation?.thresholdEth ?? null;
          out.generation = launch.generation;
          out.creatorSharePercent = launch.fees?.creatorSharePercent ?? null;
          out.supply = launch.supply;
          out.decimals = launch.decimals ?? 18;
          out.supplyTokens = launch.supplyTokens ?? null;
          out.poolFee = launch.poolFee ?? null;
          out.pool = launch.pool ?? out.pool;
        }
      } catch {
        // A single bad token must not blank the whole feed.
        out.enrichFailed = true;
      }
      return out;
    })
  );

  const graduated = enriched.filter((l) => l.graduated === true);
  const trading = enriched.filter((l) => l.graduated === false);

  const totalMcapWeth = enriched.reduce(
    (sum, l) => sum + (Number.isFinite(l.marketCapWeth) ? l.marketCapWeth : 0),
    0
  );

  const value = {
    launches: enriched,
    stats: {
      // `scanned` is the number of launches seen in the window — deliberately
      // not called "total", because the window is bounded and the real all-time
      // count is higher. Overstating it would be a lie on the front page.
      scanned: all.length,
      enriched: enriched.length,
      graduated: graduated.length,
      trading: trading.length,
      totalMcapWeth,
      windowBlocks: maxBlocks,
      fromBlock,
      toBlock: head,
    },
    truncated,
    note: truncated
      ? "The RPC cut the log scan short, so this is a partial window. A private RPC returns the full range."
      : null,
  };

  cache.set(key, { at: Date.now(), value });
  return value;
}

module.exports = {
  listLaunches,
  scanLaunchLogs,
  baseLaunch,
  TOKEN_LAUNCHED_TOPIC,
  TOKEN_LAUNCHED_SIG,
  FACTORY_EVENT_ABI,
};
