import { base64ArrayBuffer } from "./strings";
import { TokenStandard } from "./metadata";

/**
 * Parse the middle path segment of `/eip155:<chain>/<here>/<tokenId>`.
 *
 * CAIP-22 spells it `erc721`, CAIP-29 spells it `erc1155`; `eip721`/`eip1155`
 * are accepted because this service used to emit them.
 */
export function parseTokenSegment(
  segment: string | undefined
): { standard: TokenStandard; contract: string } | null {
  if (!segment) return null;
  const colon = segment.indexOf(":");
  if (colon === -1) return null;
  const kind = segment.slice(0, colon).toLowerCase();
  const contract = segment.slice(colon + 1);
  if (!contract) return null;
  if (kind === "erc721" || kind === "eip721") {
    return { standard: "erc721", contract };
  }
  if (kind === "erc1155" || kind === "eip1155") {
    return { standard: "erc1155", contract };
  }
  return null;
}

export type GatewayKind = "ipfs" | "ipns" | "ar";

/**
 * The gateways WE choose, in the order we try them.
 *
 * More than one because substituting our choice for the token's would be a
 * poor trade if our choice were the only one: dweb.link and w3s.link redirect
 * to their subdomain form, which fetch() follows, and both serve a CID ipfs.io
 * serves. Arweave has one entry because the alternatives tried were dead.
 */
export const GATEWAYS: Record<GatewayKind, string[]> = {
  ipfs: [
    "https://ipfs.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://w3s.link/ipfs/",
  ],
  ipns: ["https://ipfs.io/ipns/", "https://dweb.link/ipns/"],
  ar: ["https://arweave.net/"],
};

/**
 * A content-addressed URI rewritten to a public gateway, for OUR OWN fetches.
 *
 * Server-side only. What the browser should be given is gatewayPath(): a path
 * on this origin, because public gateways treat a browser-shaped request very
 * differently from ours (see the comment there).
 */
export function gatewayURI(uri: string): string {
  return candidateURIs(uri)[0];
}

/**
 * Every URL worth trying for one URI, best first.
 *
 * For content-addressed URIs that is our own gateways in order, and then, if
 * the token named a gateway itself, that one last. Ours first because a CID is
 * the claim and the courier is ours to pick; theirs last because a courier we
 * cannot reach is still better than no bytes at all, and a hardcoded gateway
 * is where the content was last known to be.
 */
export function candidateURIs(uri: string): string[] {
  const path = gatewayPath(uri);
  if (!path) return [uri];
  const slash = path.indexOf("/", 1);
  const kind = path.slice(1, slash) as GatewayKind;
  const rest = path.slice(slash + 1);
  const candidates = GATEWAYS[kind].map((base) => base + rest);
  if (/^https?:\/\//i.test(uri) && candidates.indexOf(uri) === -1) {
    candidates.push(uri);
  }
  return candidates;
}

/**
 * Every source a BROWSER can try for one image, in order.
 *
 * The browser's version of `candidateURIs`, and deliberately shorter: the
 * server tries every gateway it knows, while the page asks THIS origin, which
 * does that trying on its behalf. So there are at most two entries, our path
 * and then the courier the token named, and usually one.
 *
 * When they are all exhausted the caller has one more thing to show, and it is
 * not another URL: the preview our server already rendered. A token page only
 * exists because the server fetched this image to make that preview, so an
 * image that fails HERE and nowhere else is a fact about this browser's route
 * to that host, not about the token. Worth saying out loud rather than
 * leaving a broken image icon: a DNS filter that NXDOMAINs the art's host is
 * enough to do it, which is how this was found.
 */
export function imageAttempts(uri: string): string[] {
  const path = gatewayPath(uri);
  const isHttp = /^https?:/i.test(uri);
  if (!path) return [uri];
  // Content-addressed: ours first, and the token's own courier after it, for
  // the same reason candidateURIs orders them that way.
  return isHttp ? [path, uri] : [path];
}

/**
 * The path on THIS origin that serves a content-addressed URI, or null if the
 * URI is not content-addressed.
 *
 * Content-addressed means `ipfs://`, `ipns://`, `ar://` AND the https URLs
 * that are those things wearing a hat: a hardcoded public gateway. A token
 * that says `https://ipfs.io/ipfs/<cid>` has not chosen ipfs.io in any
 * meaningful sense, it has named a CID and then written down whichever gateway
 * was in the tutorial. The CID is the claim; the gateway is a courier, and
 * which courier is the client's business (ideally a local p2p node, and
 * certainly not one that answers browsers with a challenge page). So those are
 * recognised and served from here too.
 *
 * The line is drawn at the CID: a gateway URL is only treated as one when the
 * thing in the gateway position actually parses as a content address. An
 * ordinary `https://api.example/token/1` stays exactly what it is, the
 * project's own claim about where its metadata lives, and if that host refuses
 * cross-origin reads the page must show that failure rather than papering over
 * it with a proxy.
 *
 * NOTE: this function's source is injected verbatim into the token page, so it
 * must stay self-contained: no imports, no module-scope references, nothing an
 * older browser would choke on.
 */
export function gatewayPath(uri: string): string | null {
  if (typeof uri !== "string") return null;

  // A CID: v0 base58 (Qm...), v1 base32 (bafy...), base36 (k...), base58 (z...).
  var isCID = function (value: string): boolean {
    return (
      /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value) ||
      /^b[a-z2-7]{40,}$/i.test(value) ||
      /^k[a-z0-9]{40,}$/i.test(value) ||
      /^z[1-9A-HJ-NP-Za-km-z]{40,}$/.test(value)
    );
  };
  // An IPNS name is a key like a CID, or a DNSLink domain.
  var isIPNSName = function (value: string): boolean {
    return isCID(value) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value);
  };
  // An Arweave transaction id: 32 bytes, base64url.
  var isTxID = function (value: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(value);
  };

  if (uri.indexOf("ipfs://") === 0) {
    var direct = uri.slice(7);
    // `ipfs://ipfs/Qm...` appears in the wild; both halves mean the same thing.
    if (direct.indexOf("ipfs/") === 0) direct = direct.slice(5);
    return direct ? "/ipfs/" + direct : null;
  }
  if (uri.indexOf("ipns://") === 0) {
    return uri.length > 7 ? "/ipns/" + uri.slice(7) : null;
  }
  if (uri.indexOf("ar://") === 0) {
    return uri.length > 5 ? "/ar/" + uri.slice(5) : null;
  }
  if (!/^https?:\/\//i.test(uri)) return null;

  // Split the URL by hand rather than with URL(): this runs in the page too,
  // and the query/fragment are gateway decoration that a CID does not need.
  var afterScheme = uri.slice(uri.indexOf("//") + 2);
  var cut = afterScheme.search(/[/?#]/);
  var host = (cut === -1 ? afterScheme : afterScheme.slice(0, cut)).toLowerCase();
  var rest = cut === -1 || afterScheme.charAt(cut) !== "/" ? "" : afterScheme.slice(cut + 1);
  var query = rest.search(/[?#]/);
  if (query !== -1) rest = rest.slice(0, query);
  if (!host) return null;

  // Path form, the gateway convention: <host>/ipfs/<cid>/<path>
  var segments = rest.split("/");
  if ((segments[0] === "ipfs" || segments[0] === "ipns") && segments[1]) {
    var ok =
      segments[0] === "ipfs" ? isCID(segments[1]) : isIPNSName(segments[1]);
    if (ok) return "/" + segments[0] + "/" + segments.slice(1).join("/");
  }

  // Subdomain form: <cid>.ipfs.<host>/<path>
  var labels = host.split(".");
  if (labels.length > 2 && (labels[1] === "ipfs" || labels[1] === "ipns")) {
    var subject = labels[0];
    var valid = labels[1] === "ipfs" ? isCID(subject) : isIPNSName(subject);
    if (valid) {
      return "/" + labels[1] + "/" + subject + (rest ? "/" + rest : "");
    }
  }

  // Arweave has no path marker, so the host has to be a known gateway. The
  // suffix match is for the sandboxed subdomain form arweave.net redirects to,
  // `<base32>.arweave.net/<txid>`, which is what CloneX writes onchain.
  if (
    host === "arweave.net" ||
    host.slice(-12) === ".arweave.net" ||
    host === "arweave.dev" ||
    host === "ar-io.net" ||
    host === "g8way.io"
  ) {
    var arSegments = rest.split("/");
    if (isTxID(arSegments[0])) return "/ar/" + rest;
  }

  return null;
}

export function getImageUrl(request: Request, imageID: string): string {
  const url = new URL(request.url);
  const imageURL = url.protocol + "//" + url.host + "/images/" + imageID;
  return imageURL;
}

const regex = /\//gm;
export function cssURLEscaped(uri: string): string {
  return uri.replace(regex, "\\/");
}

export async function blobToDataURI(blob): Promise<string> {
  const arr = await blob.arrayBuffer();
  return `data:${blob.type};base64,${base64ArrayBuffer(arr)}`;
  // return new Promise((resolve, _) => {
  //   const reader = new FileReader();
  //   reader.onloadend = () => resolve(reader.result as string);
  //   reader.readAsDataURL(blob);
  // });
}
