/**
 * `?maxAge`: an optional freshness bound on the token cache.
 *
 * Driven through the worker's own fetch handler, so the routing, the query
 * parsing and the response headers are the ones production serves. KV, R2 and
 * the browser are in-memory fakes, and the chain is a stubbed global fetch that
 * counts tokenURI reads, so every case can say exactly how many reads it cost.
 */
import { defaultAbiCoder } from "@ethersproject/abi";
import worker from "../src/index";
import { MIN_MAX_AGE, parseMaxAge } from "../functions/_handlers/token";
import { courtesyEnabled } from "../functions/_utils/clientCourtesy";
import { Base64 } from "../functions/_utils/base64";
import { sha256 } from "../functions/_utils/strings";
import { eq, report, section } from "./assert";

const RPC = "https://rpc.test/";
const CONTRACT = "0x00000000000000000000000000000000000a11ce";
const ORIGIN = "https://embed.art";
const PAGE = `${ORIGIN}/eip155:1/erc721:${CONTRACT}/7`;
const IMAGE = `${ORIGIN}/image/eip155:1/erc721:${CONTRACT}/7`;
const AUDIO = `${ORIGIN}/audio/eip155:1/erc721:${CONTRACT}/7`;
const KEY = `erc721:1:${CONTRACT}:7`;
const STRICT_KEY = `${KEY}:strict`;

/** A pet in a given mood: a data: tokenURI whose image changes with state. */
function petURI(mood: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text>${mood}</text></svg>`;
  return `data:application/json;base64,${Base64.encode(
    JSON.stringify({
      name: `Pet (${mood})`,
      image: `data:image/svg+xml;base64,${Base64.encode(svg)}`,
      animation_url: "data:audio/wav;base64,UklGRg==",
    })
  )}`;
}

function stored(tokenURI: string) {
  return {
    tokenURI,
    tokenURIBase64Encoded: Base64.encode(tokenURI),
    contractMetadata: {},
    block: { number: 100, hash: "0xblock" },
  };
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type Entry = { value: string; metadata?: any };

function makeEnv() {
  const kv = new Map<string, Entry>();
  const r2 = new Map<string, Uint8Array>();
  const stats = { kvPuts: 0, r2Puts: 0, screenshots: 0 };
  const env = {
    ETHEREUM_NODE: RPC,
    DATA_CACHE: {
      async get(key: string, opts?: { type?: string }) {
        const e = kv.get(key);
        if (!e) return null;
        return opts?.type === "json" ? JSON.parse(e.value) : e.value;
      },
      async getWithMetadata(key: string, opts?: { type?: string }) {
        const e = kv.get(key);
        if (!e) return { value: null, metadata: null };
        return {
          value: opts?.type === "json" ? JSON.parse(e.value) : e.value,
          metadata: e.metadata ?? null,
        };
      },
      async put(key: string, value: string, opts?: { metadata?: any }) {
        stats.kvPuts++;
        kv.set(key, { value, metadata: opts?.metadata });
      },
    },
    IMAGES: {
      async head(id: string) {
        return r2.has(id) ? {} : null;
      },
      async put(id: string, buf: ArrayBuffer) {
        stats.r2Puts++;
        r2.set(id, new Uint8Array(buf));
      },
    },
    BROWSER: {
      async quickAction() {
        stats.screenshots++;
        return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
      },
    },
  };
  return { env, kv, r2, stats };
}

/** The chain, as far as these tests need it. `current.uri` is live state. */
const chain = { uri: petURI("happy"), reads: 0, down: false };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input.url;
  if (url !== RPC) throw new Error(`unexpected fetch in test: ${url}`);
  if (chain.down) throw new Error("node unreachable");
  const body = JSON.parse(init.body);
  const reply = (result: unknown) =>
    new Response(JSON.stringify({ id: 1, jsonrpc: "2.0", result }));
  if (body.method === "eth_blockNumber") return reply("0x100");
  if (body.method === "eth_getBlockByNumber") {
    return reply({ number: "0xf4", hash: "0xblock" });
  }
  if (body.method === "eth_call") {
    const data: string = body.params[0].data;
    if (data.startsWith("0xc87b56dd")) {
      chain.reads++;
      return reply(defaultAbiCoder.encode(["string"], [chain.uri]));
    }
    // name() / symbol(): an error is tolerated and leaves them unset
    return new Response(
      JSON.stringify({ id: 1, jsonrpc: "2.0", error: { message: "nope" } })
    );
  }
  throw new Error(`unexpected rpc method ${body.method}`);
}) as any;

const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
const call = (env: any, url: string) => worker.fetch(new Request(url), env, ctx);

function seed(
  kv: Map<string, Entry>,
  key: string,
  tokenURI: string,
  fetchedSecondsAgo?: number
) {
  kv.set(key, {
    value: JSON.stringify(stored(tokenURI)),
    metadata:
      fetchedSecondsAgo === undefined
        ? undefined
        : { fetchedAt: Date.now() - fetchedSecondsAgo * 1000 },
  });
}

async function imageKey(tokenURI: string): Promise<string> {
  return `1_${CONTRACT}_7`.toLowerCase() + `_${await sha256(tokenURI)}.jpg`;
}

function meta(html: string, attr: string, name: string): string | null {
  const re = new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`);
  const m = html.match(re);
  return m ? m[1] : null;
}

function maxAgeOf(res: Response): number | null {
  const cc = res.headers.get("cache-control");
  const m = cc && cc.match(/max-age=(\d+)/);
  return m ? Number(m[1]) : null;
}

function headerList(res: Response): string {
  return JSON.stringify([...res.headers.entries()].sort());
}

async function main() {
  const OLD = petURI("asleep");
  const NEW = petURI("happy");
  const OLD_IMAGE = `${ORIGIN}/images/${await imageKey(OLD)}`;
  const NEW_IMAGE = `${ORIGIN}/images/${await imageKey(NEW)}`;

  section("parseMaxAge");
  const p = (q: string) => parseMaxAge(`${PAGE}${q}`);
  eq("absent", p(""), undefined);
  eq("a value above the floor is kept", p("?maxAge=3600"), 3600);
  eq("the floor is what it says", MIN_MAX_AGE, 600);
  eq("below the floor is raised", p("?maxAge=60"), 600);
  eq("zero is raised", p("?maxAge=0"), 600);
  eq("not a number is ignored", p("?maxAge=abc"), undefined);
  eq("negative is ignored", p("?maxAge=-5"), undefined);
  eq("fractional is ignored", p("?maxAge=1.5"), undefined);
  eq("empty is ignored", p("?maxAge="), undefined);
  eq("exponent form is ignored", p("?maxAge=1e5"), undefined);
  eq("beyond a safe integer is ignored", p("?maxAge=" + "9".repeat(30)), undefined);
  eq("among other params", p("?v=123&maxAge=900&strict"), 900);

  section("no maxAge: exactly as before");
  {
    chain.uri = NEW;
    chain.reads = 0;
    const { env, kv, stats } = makeEnv();
    seed(kv, KEY, OLD); // an entry from before fetch times were recorded
    const before = kv.get(KEY)!.value;
    const res = await call(env, PAGE);
    const html = await res.text();
    eq("no chain read", chain.reads, 0);
    eq("the old entry is served", meta(html, "property", "og:image"), OLD_IMAGE);
    eq("the entry is untouched", kv.get(KEY)!.value, before);
    eq("nothing written to KV", stats.kvPuts, 0);
    eq("headers are content-type only", headerList(res), JSON.stringify([["content-type", "text/html"]]));

    // A miss stores the same bytes as it always did.
    const fresh = makeEnv();
    await call(fresh.env, PAGE);
    eq("a miss reads the chain once", chain.reads, 1);
    eq(
      "and stores exactly the data, no extra fields in the value",
      Object.keys(JSON.parse(fresh.kv.get(KEY)!.value)).sort(),
      ["block", "contractMetadata", "tokenURI", "tokenURIBase64Encoded"]
    );
    eq("its fetch time is in KV metadata", typeof fresh.kv.get(KEY)!.metadata?.fetchedAt, "number");

    const img = await call(env, IMAGE);
    eq("/image/ keeps its 3600s lifetime", img.headers.get("cache-control"), "public, max-age=3600");
    eq("/image/ redirects to the old preview", img.headers.get("location"), OLD_IMAGE);
    const audio = await call(env, AUDIO);
    eq("/audio/ stays immutable", audio.headers.get("cache-control"), "public, max-age=31536000, immutable");
    eq("still no chain read", chain.reads, 1);
  }

  section("maxAge with a fresh entry");
  {
    chain.uri = NEW;
    chain.reads = 0;
    const { env, kv, stats } = makeEnv();
    seed(kv, KEY, OLD, 100);
    const res = await call(env, `${PAGE}?maxAge=3600`);
    const html = await res.text();
    eq("no chain read", chain.reads, 0);
    eq("the cached entry is served", meta(html, "property", "og:image"), OLD_IMAGE);
    eq("nothing written to KV", stats.kvPuts, 0);
    const age = maxAgeOf(res)!;
    eq("page lifetime is what is left of maxAge", age <= 3500 && age >= 3498, true);
  }

  section("maxAge with a stale entry, or one with no fetch time");
  for (const [label, ago] of [
    ["stale", 4000],
    ["no fetch time", undefined],
  ] as const) {
    chain.uri = NEW;
    chain.reads = 0;
    const { env, kv } = makeEnv();
    seed(kv, KEY, OLD, ago);
    const res = await call(env, `${PAGE}?maxAge=3600`);
    const html = await res.text();
    eq(`${label}: one chain read`, chain.reads, 1);
    eq(`${label}: entry replaced`, JSON.parse(kv.get(KEY)!.value).tokenURI, NEW);
    const fetchedAt = kv.get(KEY)!.metadata?.fetchedAt;
    eq(`${label}: fetch time recorded`, Math.abs(Date.now() - fetchedAt) < 5000, true);
    eq(`${label}: og:image is the new preview`, meta(html, "property", "og:image"), NEW_IMAGE);
    eq(`${label}: twitter:image too`, meta(html, "name", "twitter:image"), NEW_IMAGE);
    eq(`${label}: page lifetime is maxAge`, res.headers.get("cache-control"), "public, max-age=3600");

    // and the next request within the bound is served from the new entry
    await call(env, `${PAGE}?maxAge=3600`);
    eq(`${label}: the replacement is then fresh`, chain.reads, 1);
  }

  section("the floor");
  {
    chain.uri = NEW;
    chain.reads = 0;
    const { env, kv } = makeEnv();
    seed(kv, KEY, OLD, 300); // older than the 60 asked for, younger than 600
    const res = await call(env, `${PAGE}?maxAge=60`);
    eq("maxAge=60 is raised to 600: a 300s-old entry is fresh", chain.reads, 0);
    eq("lifetime bounded by the floor", maxAgeOf(res)! <= 300, true);
    seed(kv, KEY, OLD, 700);
    await call(env, `${PAGE}?maxAge=0`);
    eq("a 700s-old entry is stale even under the floor", chain.reads, 1);
  }

  section("an invalid maxAge is ignored");
  for (const bad of ["abc", "-5", "1.5", ""]) {
    chain.uri = NEW;
    chain.reads = 0;
    const { env, kv } = makeEnv();
    seed(kv, KEY, OLD);
    const res = await call(env, `${PAGE}?maxAge=${bad}`);
    const html = await res.text();
    eq(`maxAge=${bad}: no chain read`, chain.reads, 0);
    eq(`maxAge=${bad}: old entry served`, meta(html, "property", "og:image"), OLD_IMAGE);
    eq(`maxAge=${bad}: no cache-control, as without it`, res.headers.get("cache-control"), null);
  }

  section("images are keyed by the tokenURI hash");
  {
    chain.reads = 0;
    const { env, kv, r2, stats } = makeEnv();
    // Unchanged token: one read, no new image.
    chain.uri = OLD;
    seed(kv, KEY, OLD, 4000);
    r2.set(await imageKey(OLD), new Uint8Array([1]));
    const same = await call(env, `${IMAGE}?maxAge=600`);
    eq("unchanged: one chain read", chain.reads, 1);
    eq("unchanged: same image key", same.headers.get("location"), OLD_IMAGE);
    eq("unchanged: no new screenshot", stats.screenshots, 0);
    eq("unchanged: nothing written to R2", stats.r2Puts, 0);

    // Changed token: a new image under a new key.
    chain.uri = NEW;
    seed(kv, KEY, OLD, 4000);
    const changed = await call(env, `${IMAGE}?maxAge=600`);
    eq("changed: one more chain read", chain.reads, 2);
    eq("changed: new image key", changed.headers.get("location"), NEW_IMAGE);
    eq("changed: one screenshot", stats.screenshots, 1);
    eq("changed: stored in R2 under the new key", r2.has(await imageKey(NEW)), true);
    eq("the old image is left alone", r2.has(await imageKey(OLD)), true);
  }

  section("cache-control never exceeds maxAge");
  {
    chain.uri = NEW;
    const { env, kv } = makeEnv();
    for (const [route, url] of [
      ["page", PAGE],
      ["image", IMAGE],
      ["audio", AUDIO],
    ]) {
      for (const [maxAge, bound] of [
        ["600", 600],
        ["900", 900],
        ["60", 600],
      ] as const) {
        seed(kv, KEY, NEW, 50);
        const res = await call(env, `${url}?maxAge=${maxAge}`);
        const age = maxAgeOf(res);
        eq(`${route} maxAge=${maxAge}: lifetime <= ${bound}`, age !== null && age <= bound, true);
        eq(
          `${route} maxAge=${maxAge}: not immutable`,
          (res.headers.get("cache-control") || "").includes("immutable"),
          false
        );
      }
    }
    // image placeholders too
    const broken = makeEnv();
    chain.down = true;
    const res = await call(broken.env, `${IMAGE}?maxAge=900`);
    chain.down = false;
    eq("placeholder lifetime is still bounded", maxAgeOf(res)! <= 900, true);
  }

  section("a stale entry survives a failed re-read");
  {
    chain.reads = 0;
    const { env, kv } = makeEnv();
    seed(kv, KEY, OLD, 4000);
    chain.down = true;
    const res = await call(env, `${PAGE}?maxAge=600`);
    chain.down = false;
    const html = await res.text();
    eq("the last known data is served", meta(html, "property", "og:image"), OLD_IMAGE);
    eq("and not cached", res.headers.get("cache-control"), "public, max-age=0");
    eq("the entry is not rewritten", kv.get(KEY)!.metadata?.fetchedAt < Date.now() - 3000 * 1000, true);
  }

  section("a refresh whose KV write is refused still serves the new data");
  {
    chain.uri = NEW;
    chain.reads = 0;
    const { env, kv } = makeEnv();
    seed(kv, KEY, OLD, 4000);
    env.DATA_CACHE.put = async () => {
      throw new Error("429 too many writes to the same key");
    };
    const res = await call(env, `${PAGE}?maxAge=600`);
    const html = await res.text();
    eq("one chain read", chain.reads, 1);
    eq("the page is the fresh one", meta(html, "property", "og:image"), NEW_IMAGE);
    eq("and not cached", res.headers.get("cache-control"), "public, max-age=0");
  }

  section("strict is orthogonal");
  {
    chain.uri = NEW;
    chain.reads = 0;
    const { env, kv } = makeEnv();
    seed(kv, KEY, OLD);
    seed(kv, STRICT_KEY, OLD);
    await call(env, `${PAGE}?strict&maxAge=600`);
    eq("strict + maxAge reads once", chain.reads, 1);
    eq("and refreshes the strict entry", JSON.parse(kv.get(STRICT_KEY)!.value).tokenURI, NEW);
    eq("leaving the courtesy entry alone", JSON.parse(kv.get(KEY)!.value).tokenURI, OLD);
  }

  section("unknown parameters are ignored");
  {
    chain.uri = NEW;
    chain.reads = 0;
    const { env, kv } = makeEnv();
    seed(kv, KEY, OLD);
    const plain = await call(env, PAGE);
    const withV = await call(env, `${PAGE}?v=123`);
    const plainHTML = await plain.text();
    const withVHTML = await withV.text();
    eq("?v=123: same status", withV.status, plain.status);
    eq("?v=123: same headers", headerList(withV), headerList(plain));
    eq("?v=123: same og:image", meta(withVHTML, "property", "og:image"), meta(plainHTML, "property", "og:image"));
    eq("?v=123: og:url stays canonical", meta(withVHTML, "property", "og:url"), PAGE);
    eq("?v=123: no chain read", chain.reads, 0);

    const img = await call(env, `${IMAGE}?v=123`);
    eq("/image/?v=123 behaves as /image/", img.headers.get("location"), OLD_IMAGE);
    const audio = await call(env, `${AUDIO}?utm_source=x`);
    eq("/audio/?utm_source=x behaves as /audio/", audio.status, 200);

    await call(env, `${PAGE}?v=123&maxAge=600`);
    eq("?v=123&maxAge=600 still refreshes", chain.reads, 1);

    // The page decides client-side whether it is strict. It used to look for
    // the substring, so a sharer's ?ref=restricted switched the repairs off.
    eq("courtesy: no query", courtesyEnabled(""), true);
    eq("courtesy: ?v=123", courtesyEnabled("?v=123"), true);
    eq("courtesy: ?ref=restricted", courtesyEnabled("?ref=restricted"), true);
    eq("courtesy: ?strictly=1", courtesyEnabled("?strictly=1"), true);
    eq("courtesy: ?strict", courtesyEnabled("?strict"), false);
    eq("courtesy: ?strict=1", courtesyEnabled("?strict=1"), false);
    eq("courtesy: ?v=1&strict", courtesyEnabled("?v=1&strict"), false);
    eq("courtesy: ?strict&maxAge=600", courtesyEnabled("?strict&maxAge=600"), false);
  }
}

main()
  .catch((err) => {
    console.error(err);
    eq("the freshness tests ran to completion", String(err), "");
  })
  .finally(() => {
    globalThis.fetch = realFetch;
    report();
  });
