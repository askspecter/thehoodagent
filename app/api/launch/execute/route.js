import { NextResponse } from "next/server";
import { Contract, Interface, JsonRpcProvider, parseEther } from "ethers";
import { deriveSigner, getChain } from "@/lib/engine";
import { getSession } from "@/lib/session";

/**
 * POST /api/launch/execute — create a token, signed with the caller's X wallet.
 *
 * Signing in with X already mints a wallet, so creating a token needs no browser
 * extension: the launch is signed server-side with the wallet derived from the
 * session. That is why the create form has no "connect wallet" step for anyone
 * signed in.
 *
 * What keeps it safe is that almost nothing the client says is trusted for the
 * parts that matter: the wallet is derived from the SESSION (so a request can
 * only spend the caller's own funds), the fee wallet is FORCED to that same
 * address (creator fees cannot be pointed elsewhere), the factory address and
 * the launch fee come from server config, and the call is dry-run with
 * `staticCall` before a wei is spent.
 */

/** TokenLaunched(token, …). The new token is the first indexed topic. */
const TOKEN_LAUNCHED_TOPIC =
  "0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a";

/** Default for a field type, so an unfilled argument still encodes. */
function emptyFor(type) {
  if (type === "address") return "0x0000000000000000000000000000000000000000";
  if (/^u?int/.test(type)) return "0";
  if (type === "bool") return false;
  if (type.endsWith("[]")) return [];
  const fixed = type.match(/^bytes(\d+)$/);
  if (fixed) return "0x" + "00".repeat(Number(fixed[1]));
  if (type === "bytes") return "0x";
  return "";
}

/** Rebuild the nested argument tree the ABI expects from a flat value map. */
function buildArgs(inputs, values, pathPrefix = []) {
  return inputs.map((input, index) => {
    const path = [...pathPrefix, input.name || `arg${index}`];
    if (input.type === "tuple" && Array.isArray(input.components)) {
      return buildArgs(input.components, values, path);
    }
    const key = path.join(".");
    const raw = values[key];
    if (raw === undefined || raw === "") return emptyFor(input.type);
    if (/^u?int/.test(input.type)) {
      return values[`${key}__isEth`] ? parseEther(String(raw)).toString() : String(raw);
    }
    if (input.type === "bool") return Boolean(raw);
    return raw;
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const {
    fnName,
    fnInputs,
    values = {},
    feePath = null,
    buyEth = 0,
    network = "robinhood",
  } = body || {};

  if (!fnName || !Array.isArray(fnInputs)) {
    return NextResponse.json({ error: "Missing the launch function ABI." }, { status: 400 });
  }

  let session;
  try {
    session = await getSession();
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json(
      { error: "Sign in with X first — the launch is signed with your X wallet." },
      { status: 401 }
    );
  }

  let chain;
  try {
    chain = getChain(network);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const factory = chain.pons?.factory;
  if (!factory) {
    return NextResponse.json(
      { error: "This network has no pons factory configured." },
      { status: 400 }
    );
  }

  let signer;
  try {
    signer = deriveSigner(session.id, chain);
  } catch (error) {
    // Almost always a missing WALLET_DERIVATION_SECRET.
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const owner = await signer.getAddress();
  const provider = signer.provider;

  // Creator fees always go to the caller's own X wallet — never a value the
  // client chose.
  const safeValues = feePath ? { ...values, [feePath]: owner } : values;

  const iface = new Interface([
    { type: "function", name: fnName, inputs: fnInputs, outputs: [], stateMutability: "payable" },
  ]);

  let data;
  try {
    data = iface.encodeFunctionData(fnName, buildArgs(fnInputs, safeValues));
  } catch (error) {
    return NextResponse.json(
      { error: `Could not encode the launch: ${error.shortMessage || error.message}` },
      { status: 400 }
    );
  }

  // Launch fee (server config) plus whatever the creator wants to buy at launch.
  const buy = Number(buyEth);
  const totalEth = Number(chain.pons.launchFeeEth || 0) + (Number.isFinite(buy) && buy > 0 ? buy : 0);
  const value = parseEther(totalEth.toFixed(18));

  try {
    const balance = await provider.getBalance(owner);
    if (balance <= value) {
      return NextResponse.json(
        {
          error: `Your X wallet holds too little ETH to cover the ${chain.pons.launchFeeEth} ETH fee${
            buy > 0 ? ` plus your ${buy} ETH first buy` : ""
          } and gas.`,
          hint: "Send ETH to your X wallet address on the Profile tab first.",
        },
        { status: 400 }
      );
    }

    // Dry run. A revert here costs nothing; on chain it costs gas.
    try {
      await provider.call({ to: factory, data, value, from: owner });
    } catch (error) {
      return NextResponse.json(
        {
          error: `Simulation reverted, so nothing was sent: ${
            error.shortMessage || error.reason || error.message
          }`,
          hint: "The factory rejected these arguments. Check the name, symbol and first-buy amount.",
        },
        { status: 400 }
      );
    }

    const tx = await signer.sendTransaction({ to: factory, data, value });
    const receipt = await tx.wait();

    if (receipt.status === 0) {
      return NextResponse.json(
        { error: "The transaction was mined but reverted. Nothing was created.", hash: tx.hash },
        { status: 400 }
      );
    }

    const launchedLog = receipt.logs?.find(
      (log) => log.topics?.[0]?.toLowerCase() === TOKEN_LAUNCHED_TOPIC
    );
    const token = launchedLog?.topics?.[1] ? "0x" + launchedLog.topics[1].slice(-40) : null;

    return NextResponse.json({ ok: true, hash: tx.hash, token, owner, explorer: chain.explorer });
  } catch (error) {
    console.error("Launch execute failed:", error);
    const message = error.shortMessage || error.reason || error.message || "The launch failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
