#!/usr/bin/env node
/**
 * How much NFT art is still there?
 *
 * This walks the question end to end and writes a dataset anyone can check:
 *
 *   1. SAMPLE   read ERC-721 Transfer logs from a spread of historical blocks,
 *               which yields contracts that were actually being used then,
 *               rather than a list somebody curated.
 *   2. RESOLVE  ask each contract for a tokenURI and keep the ones that are
 *               content-addressed. A hardcoded gateway URL counts: it names a
 *               CID, which is the thing being tested.
 *   3. VERIFY   try to fetch each CID from several public gateways, twice,
 *               with generous timeouts. Content nobody provides any more fails
 *               everywhere, every time; content that is merely slow does not.
 *
 * What a failure means, precisely: no gateway we asked could find a provider
 * within the timeout. That is not proof the bytes are destroyed. Somebody may
 * hold them offline, and re-pinning revives the CID instantly. It does mean
 * that today, for a normal person with a normal client, the art does not load.
 *
 *   node tools/survey-unpinned.mjs                    # the documented default
 *   node tools/survey-unpinned.mjs --from 16200000 --to 21000000
 *   node tools/survey-unpinned.mjs --help
 *
 * Needs an Ethereum RPC endpoint: ETHEREUM_NODE in the environment, or the
 * .dev.vars file this project already uses for wrangler.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGatewayPath } from "./worker-url.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  // The 2021 boom and the 2022 hangover: old enough that a project's pinning
  // bill has had time to stop being paid.
  from: 12700000,
  to: 16200000,
  step: 100000,
  // Three consecutive-ish blocks per sample point, since one block is a small
  // and arbitrary slice of activity.
  perPoint: 3,
  concurrency: 8,
  timeoutMs: 40000,
  rounds: 2,
  // Contracts to test whatever the sample turns up, comma-separated. Sampling
  // is a lottery, and a claim made elsewhere (the front page names one) should
  // be checkable in the dataset rather than only in somebody's memory.
  include: "0xecdd2f733bd20e56865750ebce33f17da0bee461",
  out: "public/data/unpinned-survey.json",
};

const GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://w3s.link/ipfs/",
  "https://nftstorage.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];
const AR_GATEWAYS = ["https://arweave.net/", "https://g8way.io/"];

const USER_AGENT = "embed.art survey (+https://embed.art/unpinned)";
const TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key === "help" || key === "h") {
      console.log(readFileSync(new URL(import.meta.url), "utf8").slice(0, 1600));
      process.exit(0);
    }
    if (!(key in DEFAULTS)) {
      console.error(`unknown option: ${argv[i]}`);
      process.exit(2);
    }
    const value = argv[++i];
    args[key] = typeof DEFAULTS[key] === "number" ? Number(value) : value;
    if (key === "include" && value === "none") args.include = "";
  }
  return args;
}

function endpoint() {
  if (process.env.ETHEREUM_NODE) return process.env.ETHEREUM_NODE;
  try {
    const vars = readFileSync(join(ROOT, ".dev.vars"), "utf8");
    const line = vars.split("\n").find((l) => l.startsWith("ETHEREUM_NODE="));
    if (line) return line.slice("ETHEREUM_NODE=".length).trim();
  } catch {}
  console.error("no RPC endpoint: set ETHEREUM_NODE or add it to .dev.vars");
  process.exit(2);
}

const RPC = endpoint();
let rpcCalls = 0;

async function rpc(method, params) {
  rpcCalls++;
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 120));
  return body.result;
}

/** ABI-decode a single returned string, or null if it is not one. */
function decodeString(hex) {
  try {
    const bytes = Buffer.from(hex.slice(2), "hex");
    const offset = Number(BigInt("0x" + bytes.subarray(0, 32).toString("hex")));
    const length = Number(
      BigInt("0x" + bytes.subarray(offset, offset + 32).toString("hex"))
    );
    return bytes.subarray(offset + 32, offset + 32 + length).toString("utf8");
  } catch {
    return null;
  }
}

const u256 = (n) => BigInt(n).toString(16).padStart(64, "0");
const SELECTOR = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  totalSupply: "0x18160ddd",
  tokenURI: "0xc87b56dd",
  ownerOf: "0x6352211e",
};

async function callString(address, selector, arg) {
  try {
    return decodeString(
      await rpc("eth_call", [
        { to: address, data: selector + (arg === undefined ? "" : u256(arg)) },
        "latest",
      ])
    );
  } catch {
    return null;
  }
}

/** Run `work` over `items` with a fixed number of workers. */
async function pool(items, concurrency, work) {
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await work(item, index, items.length);
    }
  });
  await Promise.all(workers);
}

async function get(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    // Drain small bodies so the connection can be reused; ignore big ones.
    await response.arrayBuffer().catch(() => {});
    return { status: response.status, ms: Date.now() - started };
  } catch (err) {
    return {
      status: err.name === "AbortError" ? "timeout" : "error",
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // The same code production uses, so "is this content-addressed" is answered
  // once rather than by a second implementation that can drift.
  const gatewayPath = await loadGatewayPath();

  // ---------------------------------------------------------------- sample
  const blocks = [];
  for (let b = args.from; b <= args.to; b += args.step) {
    for (let n = 0; n < args.perPoint; n++) blocks.push(b + n * 7);
  }
  const contracts = new Map();
  for (const address of args.include.split(",").filter(Boolean)) {
    // token 1 exists in most collections; if it does not, the tokenURI call
    // simply fails and the contract drops out like any other.
    contracts.set(address.toLowerCase().trim(), "1");
  }
  await pool(blocks, args.concurrency, async (block) => {
    const hex = "0x" + block.toString(16);
    try {
      const logs = await rpc("eth_getLogs", [
        { fromBlock: hex, toBlock: hex, topics: [TRANSFER] },
      ]);
      for (const log of logs) {
        // An ERC-721 Transfer indexes all three arguments, so it has four
        // topics; an ERC-20 Transfer has three. That is the whole test.
        if (log.topics.length !== 4) continue;
        if (!contracts.has(log.address)) {
          contracts.set(log.address, BigInt(log.topics[3]).toString());
        }
      }
    } catch {}
  });
  console.error(
    `sampled ${blocks.length} blocks -> ${contracts.size} ERC-721 contracts`
  );

  // --------------------------------------------------------------- resolve
  const collections = [];
  await pool([...contracts], args.concurrency, async ([address, tokenId]) => {
    const tokenURI = await callString(address, SELECTOR.tokenURI, tokenId);
    if (!tokenURI) return;
    const path = gatewayPath(tokenURI);
    if (!path) return;
    const [, kind, ...rest] = path.split("/");
    collections.push({ address, tokenId, tokenURI, kind, path: rest.join("/") });
  });
  console.error(
    `${collections.length} of them are content-addressed (ipfs/ipns/ar)`
  );

  // ---------------------------------------------------------------- verify
  //
  // The gateways are asked CONCURRENTLY, which is both faster and a truer
  // question: "can anyone serve this", not "can ipfs.io serve this, and if
  // not, can dweb.link". Asked one after another, a dead CID costs the sum of
  // five timeouts per round; asked together it costs the longest one.
  const started = Date.now();
  let done = 0;
  await pool(collections, args.concurrency, async (c) => {
    const bases = c.kind === "ar" ? AR_GATEWAYS : GATEWAYS;
    c.attempts = [];
    c.reachable = false;
    for (let round = 1; round <= args.rounds; round++) {
      const answers = await Promise.all(
        bases.map(async (base) => ({
          gateway: base,
          round,
          ...(await get(base + c.path, args.timeoutMs)),
        }))
      );
      c.attempts.push(...answers);
      if (answers.some((a) => a.status === 200)) {
        c.reachable = true;
        break;
      }
    }
    done++;
    if (done % 25 === 0) {
      const rate = (Date.now() - started) / done;
      const left = Math.round(((collections.length - done) * rate) / 60000);
      console.error(
        `  verified ${done}/${collections.length} (~${left} min left)`
      );
    }
  });

  const unreachable = collections.filter((c) => !c.reachable);
  console.error(`${unreachable.length} could not be fetched from any gateway`);

  // ---------------------------------------------------------------- enrich
  await pool(unreachable, args.concurrency, async (c) => {
    c.name = await callString(c.address, SELECTOR.name);
    c.symbol = await callString(c.address, SELECTOR.symbol);
    const supply = await callString(c.address, SELECTOR.totalSupply);
    try {
      c.totalSupply = Number(
        BigInt(
          await rpc("eth_call", [
            { to: c.address, data: SELECTOR.totalSupply },
            "latest",
          ])
        )
      );
    } catch {
      c.totalSupply = null;
    }
    void supply;
    try {
      const owner = await rpc("eth_call", [
        { to: c.address, data: SELECTOR.ownerOf + u256(c.tokenId) },
        "latest",
      ]);
      c.sampledTokenIsOwned = !/^0x0+$/.test(owner);
    } catch {
      c.sampledTokenIsOwned = false;
    }
  });

  const dataset = {
    generatedAt: new Date().toISOString(),
    method: {
      blocksSampled: blocks.length,
      blockRange: [args.from, args.to],
      blockStep: args.step,
      gateways: GATEWAYS,
      arweaveGateways: AR_GATEWAYS,
      timeoutMs: args.timeoutMs,
      rounds: args.rounds,
      rpcCalls,
      note:
        "Unreachable means no listed gateway returned 200 for the token's own " +
        "content address, in any round, within the timeout. It is evidence " +
        "that the content is unpinned, not proof that it is destroyed: one " +
        "node re-providing those bytes would revive every CID here.",
    },
    totals: {
      contracts: contracts.size,
      contentAddressed: collections.length,
      unreachable: unreachable.length,
    },
    unreachable: unreachable
      .map((c) => ({
        name: c.name,
        symbol: c.symbol,
        address: c.address,
        totalSupply: c.totalSupply,
        sampledTokenId: c.tokenId,
        sampledTokenIsOwned: c.sampledTokenIsOwned,
        tokenURI: c.tokenURI,
        kind: c.kind,
        attempts: c.attempts,
      }))
      .sort((a, b) => (b.totalSupply || 0) - (a.totalSupply || 0)),
    reachable: collections
      .filter((c) => c.reachable)
      .map((c) => ({ address: c.address, tokenURI: c.tokenURI })),
  };

  const out = resolve(ROOT, args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(dataset, null, 1));
  console.error(`\nwrote ${out}`);
  console.log(
    `${dataset.totals.unreachable} of ${dataset.totals.contentAddressed} ` +
      `content-addressed collections are unreachable ` +
      `(${Math.round(
        (dataset.totals.unreachable / dataset.totals.contentAddressed) * 100
      )}%)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
