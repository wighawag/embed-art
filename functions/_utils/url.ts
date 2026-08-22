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

/**
 * A content-addressed URI rewritten to a public gateway, for OUR OWN fetches.
 *
 * Server-side only. What the browser should be given is gatewayPath(): a path
 * on this origin, because public gateways treat a browser-shaped request very
 * differently from ours (see the comment there).
 */
export function gatewayURI(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice(7).replace(/^ipfs\//, "")}`;
  }
  if (uri.startsWith("ipns://")) {
    return `https://ipfs.io/ipns/${uri.slice(7)}`;
  }
  if (uri.startsWith("ar://")) {
    return `https://arweave.net/${uri.slice(5)}`;
  }
  return uri;
}

/**
 * The path on THIS origin that serves a content-addressed URI, or null if the
 * URI is not content-addressed.
 *
 * Only `ipfs://`, `ipns://` and `ar://` qualify, and the distinction is the
 * whole point. Where a CID is fetched from is a client-side implementation
 * detail (ideally a local p2p node), so routing it through this origin changes
 * nothing about what the token says. An `https://` URL is the opposite: it is
 * the project's own claim about where its metadata lives, and if that host
 * refuses cross-origin reads the page must show that failure rather than
 * papering over it with a proxy.
 *
 * NOTE: this function's source is injected verbatim into the token page, so it
 * must stay self-contained: no imports, no module-scope references, nothing an
 * older browser would choke on.
 */
export function gatewayPath(uri: string): string | null {
  if (typeof uri !== "string") return null;
  if (uri.indexOf("ipfs://") === 0) {
    var cid = uri.slice(7);
    // `ipfs://ipfs/Qm...` appears in the wild; both halves mean the same thing.
    if (cid.indexOf("ipfs/") === 0) cid = cid.slice(5);
    return "/ipfs/" + cid;
  }
  if (uri.indexOf("ipns://") === 0) return "/ipns/" + uri.slice(7);
  if (uri.indexOf("ar://") === 0) return "/ar/" + uri.slice(5);
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
