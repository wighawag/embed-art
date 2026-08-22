/**
 * Content-addressed content, served from this origin.
 *
 *     /ipfs/<cid>/<path>   /ipns/<name>/<path>   /ar/<txid>
 *
 * Why this exists. The token page fetches metadata in the BROWSER on purpose,
 * so what you see comes from the token's own URI. For an `https://` URL that
 * is the right thing to do, and if the host refuses cross-origin reads the
 * page says so: that is the project's mistake to see. But a public IPFS
 * gateway is not the token's claim about anything, and it does not treat a
 * browser the way it treats a server. ipfs.io, fronted by Cloudflare's bot
 * mitigation, answers our worker `200` with `access-control-allow-origin: *`
 * and answers a browser-shaped request `403 cf-mitigated: challenge` with no
 * CORS header at all, which the browser can only report as a CORS failure.
 * Same URL, same moment, opposite answers, decided by the User-Agent.
 *
 * So we make the request that works, from where it works, and hand the bytes
 * back on our own origin. Which gateway serves a CID is an implementation
 * detail; the CID is the thing that was addressed. A client with a local node
 * could do better still, and should.
 *
 * The browser's own headers are deliberately NOT forwarded upstream. Passing
 * its User-Agent through would recreate exactly the challenge this route
 * exists to avoid.
 */

import { fetchAsService } from "../_utils/request";

export type GatewayKind = "ipfs" | "ipns" | "ar";

const GATEWAYS: Record<GatewayKind, string> = {
  ipfs: "https://ipfs.io/ipfs/",
  ipns: "https://ipfs.io/ipns/",
  ar: "https://arweave.net/",
};

/** A CID is immutable, so its bytes can be cached for as long as we like. */
const IMMUTABLE = "public, max-age=29030400, immutable";
/** An IPNS name is a mutable pointer; cache it the way a DNS record is cached. */
const MUTABLE = "public, max-age=60";

/**
 * The upstream URL for a request path, or null if the path is not one we are
 * willing to fetch. Everything after the prefix is opaque to us except for the
 * checks here: no scheme, no host, no traversal, so this cannot be talked into
 * fetching something other than gateway content.
 */
export function upstreamFor(kind: GatewayKind, path: string): string | null {
  if (!path) return null;
  let cleaned = path.replace(/^\/+/, "");
  if (kind === "ipfs" && cleaned.indexOf("ipfs/") === 0) {
    cleaned = cleaned.slice(5);
  }
  if (!cleaned) return null;
  // Decoded before the check: `%2e%2e` is `..` by the time a gateway sees it,
  // and whether anything in between normalises it first is not our assumption
  // to make.
  let decoded = cleaned;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    return null;
  }
  if (cleaned.indexOf("..") !== -1 || decoded.indexOf("..") !== -1) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)) return null;
  // A CID/txid is alphanumeric; the rest of the path may be a file name.
  if (!/^[A-Za-z0-9][A-Za-z0-9._~%!$&'()*+,;=:@/-]*$/.test(cleaned)) return null;
  return GATEWAYS[kind] + cleaned;
}

/** Headers worth passing on: enough for range requests and revalidation. */
const FORWARDED = ["accept", "range", "if-none-match", "if-modified-since"];
/** Headers worth keeping from upstream: content shape, not its policies. */
const KEPT = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

/**
 * What we send back for gateway content.
 *
 * The sandbox directive is the price of hosting other people's bytes on our
 * own name. Some NFT art IS an HTML document, and one served from embed.art
 * would otherwise run WITH embed.art's origin: same-origin fetches, our
 * storage, our cookies if we ever set any. A public gateway used to absorb
 * that risk simply by being somewhere else. `sandbox allow-scripts` gives the
 * document an opaque origin while still letting the art run, and it applies
 * whether the document is framed by our page or opened directly.
 */
export function outboundHeaders(
  kind: GatewayKind,
  upstream: Headers
): Headers {
  const out = new Headers();
  for (const name of KEPT) {
    const value = upstream.get(name);
    if (value) out.set(name, value);
  }
  out.set("cache-control", kind === "ipns" ? MUTABLE : IMMUTABLE);
  // Same-origin for our own pages, but a CID is public content and there is no
  // reason for anyone else's page to be refused it.
  out.set("access-control-allow-origin", "*");
  out.set("content-security-policy", "sandbox allow-scripts");
  // The gateway's content-type is the only one we will honour: no sniffing a
  // document out of something that was served as text.
  out.set("x-content-type-options", "nosniff");
  return out;
}

export async function gatewayRoute(
  request: Request,
  kind: GatewayKind,
  path: string
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const upstream = upstreamFor(kind, path);
  if (!upstream) {
    return new Response(`not a ${kind} path: ${path}`, { status: 400 });
  }

  // Only what a fetch needs; the visitor's own headers stay here. Forwarding
  // their User-Agent would recreate the challenge this route exists to avoid,
  // and fetchAsService puts our name on it instead.
  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let response: Response;
  try {
    response = await fetchAsService(upstream, {
      method: request.method,
      headers,
      // Content-addressed bytes never change, so let the edge keep them.
      cf: { cacheEverything: true, cacheTtl: kind === "ipns" ? 60 : 86400 },
    } as RequestInit);
  } catch (err: any) {
    return new Response(`gateway request failed: ${err.message}\n${upstream}`, {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }

  if (!response.ok && response.status !== 304 && response.status !== 206) {
    // Do not relay the gateway's error page: it may be a challenge document,
    // which would be a confusing thing to render in place of a token.
    return new Response(
      `the gateway answered ${response.status} for ${kind}://${path}`,
      { status: response.status, headers: { "cache-control": "no-store" } }
    );
  }

  return new Response(response.body, {
    status: response.status,
    headers: outboundHeaders(kind, response.headers),
  });
}
