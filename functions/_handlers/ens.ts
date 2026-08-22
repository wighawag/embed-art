import { Base64 } from "../_utils/base64";
import {
  AvatarRef,
  EnsResolution,
  parseAvatarRecord,
  resolveEns,
} from "../_utils/ens";
import { Metadata } from "../_utils/metadata";
import { sha256 } from "../_utils/strings";
import { errorPage } from "./errorPage";
import { generatePreviewImage, tokenPage } from "./token";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** ipfs:// and ar:// are not fetchable by a browser; route them via a gateway. */
export function gatewayURI(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice(7).replace(/^ipfs\//, "")}`;
  }
  if (uri.startsWith("ar://")) {
    return `https://arweave.net/${uri.slice(5)}`;
  }
  return uri;
}

const PAGE_CSS = `
  html { background-color: #111111; color: #F5DEB3; }
  * { margin: 0; padding: 0; box-sizing: border-box;
      font-family: ui-monospace, Hack, "DejaVu Sans Mono", monospace;
      /* ':' and '<' shape into one cluster in monospace faces with contextual
         alternates, and the cluster takes the colour of whichever span it
         ends in, hiding the colon in 'erc721:<contract>'. */
      font-variant-ligatures: none;
      font-feature-settings: "liga" 0, "calt" 0, "dlig" 0; }
  body { display: flex; flex-direction: column; align-items: center;
         justify-content: center; min-height: 100vh; text-align: center;
         padding: 2rem 1.25rem; line-height: 1.6; }
  .wrap { max-width: 40rem; }
  /* Letterhead, matching the unfurl cards and the error pages. */
  .brand { position: absolute; top: 30px; left: 34px; }
  .brand img { height: 26px; width: auto; display: block; }
  h1 { font-size: 1.35rem; margin-bottom: 0.75rem; }
  .name { color: #BE8F04; }
  p { opacity: 0.72; margin-bottom: 1rem; }
  .avatar { max-width: min(22rem, 80vw); width: 100%; height: auto;
            border-radius: 12px; margin: 0 auto 1.75rem; display: block; }
  .note { border: 1px solid #2E2A20; border-left: 4px solid #BE8F04;
          border-radius: 6px; padding: 0.9rem 1.1rem; text-align: left;
          font-size: 0.85rem; opacity: 0.85; margin-bottom: 1.5rem; }
  .note strong { color: #BE8F04; font-weight: normal; }
  code { color: #BE8F04; word-break: break-all; }
  .details { font-size: 0.78rem; opacity: 0.42; text-align: left;
             word-break: break-all; }
  .details div { margin: 0.15rem 0; }
  a { color: #F5DEB3; }
`;

function shell(opts: {
  title: string;
  description: string;
  url: string;
  image?: string;
  body: string;
  card?: "summary" | "summary_large_image";
}): Response {
  // Every page here is keyed by an ENS name, whose meaning its owner can
  // change at will, so none of them may be cached.
  const t = escapeHtml(opts.title);
  const d = escapeHtml(opts.description);
  const page = `<!DOCTYPE html>
<html lang="en">
    <head>
        <title>${t}</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="description" content="${d}">
        <meta property="og:type" content="website">
        <meta property="og:url" content="${escapeHtml(opts.url)}">
        <meta property="og:title" content="${t}">
        <meta property="og:description" content="${d}">
        ${opts.image ? `<meta property="og:image" content="${escapeHtml(opts.image)}">` : ""}
        <meta name="twitter:card" content="${opts.card || "summary_large_image"}">
        <meta name="twitter:title" content="${t}">
        <meta name="twitter:description" content="${d}">
        ${opts.image ? `<meta name="twitter:image" content="${escapeHtml(opts.image)}">` : ""}
        <link rel="icon" href="/favicon.ico" sizes="32x32">
        <link rel="icon" type="image/svg+xml" href="/static/icon.svg">
        <style>${PAGE_CSS}</style>
    </head>
    <body>
      <a class="brand" href="/"><img src="/static/wordmark.svg" alt="Embed.Art"></a>
      <div class="wrap">${opts.body}</div>
    </body>
</html>`;
  return new Response(page, {
    headers: { "content-type": "text/html", "cache-control": "no-store" },
  });
}

function detailBlock(rows: [string, string | null | undefined][]): string {
  const kept = rows.filter(([, v]) => v);
  if (kept.length === 0) return "";
  return `<div class="details">${kept
    .map(([k, v]) => `<div>${escapeHtml(k)}: ${escapeHtml(v as string)}</div>`)
    .join("")}</div>`;
}

/**
 * No avatar to show. Three distinct situations, and telling them apart is the
 * difference between "you typed a name nobody owns" and "your name is fine,
 * you just have not set an avatar".
 */
function noAvatarPage(
  url: string,
  resolution: EnsResolution,
  reason: "unregistered" | "no-resolver" | "no-record"
): Response {
  const name = resolution.name;
  const esc = escapeHtml(name);
  const origin = new URL(url).origin;

  const copy = {
    unregistered: {
      heading: "is not registered",
      card: "ens-unregistered",
      title: `${name} is not registered`,
      description: `Nobody owns the ENS name ${name}.`,
      body: `The ENS registry has no owner for <code>${esc}</code>. Either it has never been registered, or its registration expired and the grace period ran out.`,
    },
    "no-resolver": {
      heading: "has no resolver",
      card: "ens-no-avatar",
      title: `${name} has no resolver`,
      description: `${name} is registered but has no records set.`,
      body: `<code>${esc}</code> is registered, but no resolver is set on it, so it holds no records at all: no address, no avatar, nothing to read.`,
    },
    "no-record": {
      heading: "has no avatar",
      card: "ens-no-avatar",
      title: `${name} has no avatar`,
      description: `${name} has no ENS avatar record set.`,
      body: `<code>${esc}</code> resolves, but its <code>avatar</code> text record is empty. There is nothing for Embed.Art to show.`,
    },
  }[reason];

  const howTo =
    reason === "unregistered"
      ? `<div class="note"><strong>If it is yours to claim:</strong> register it,
         then set an <code>avatar</code> record. Pointing that record at an NFT
         you own makes this page render your token.</div>`
      : `<div class="note">
        <strong>To set one:</strong> the <code>avatar</code> record accepts an
        image URL, or a reference to an NFT you own, written as
        <code>eip155:1/erc721:&lt;contract&gt;/&lt;tokenId&gt;</code>.
        That NFT form is exactly the path this site serves, so setting it makes
        this page render your token.
      </div>`;

  return shell({
    title: copy.title,
    description: copy.description,
    url,
    image: `${origin}/static/${copy.card}.png`,
    body: `
      <h1><span class="name">${esc}</span> ${copy.heading}</h1>
      <p>${copy.body}</p>
      ${howTo}
      ${detailBlock([
        ["Name", name],
        ["Owner", resolution.owner],
        ["Resolver", resolution.resolver],
        ["Address", resolution.address],
      ])}`,
  });
}

/** The avatar is a plain image, not an NFT. Show it, and say so. */
async function imageAvatarPage(
  env: any,
  request: Request,
  url: string,
  resolution: EnsResolution,
  ref: Extract<AvatarRef, { kind: "image" }>
): Promise<Response> {
  const name = resolution.name;
  const displayURI = gatewayURI(ref.uri);

  // Run it through the same screenshot pipeline as a token, so the card that
  // unfurls is a real JPEG even when the avatar is an SVG or sits on IPFS.
  let previewURL: string | undefined;
  try {
    const metadata: Metadata = { name, image: displayURI };
    // Keyed by the avatar URI alone, NOT by the ENS name. The name is a
    // mutable pointer; the image is content. Two names sharing an avatar share
    // the render, and repointing a name simply lands on a different key rather
    // than serving a stale one under the old name.
    const imageID = `avatar_${await sha256(ref.uri)}.jpg`;
    // base64, not raw JSON: an unencoded data: URI breaks on '#' and friends.
    const syntheticTokenURI = `data:application/json;base64,${Base64.encode(
      JSON.stringify({ image: displayURI })
    )}`;
    previewURL = await generatePreviewImage(
      env,
      request,
      imageID,
      syntheticTokenURI,
      metadata,
      { ens: name }
    );
  } catch {
    // A preview failure must not lose the page; fall back to no card image.
    previewURL = undefined;
  }

  return shell({
    title: `${name}'s avatar`,
    description: `${name} has an avatar, but it is a plain image rather than an NFT.`,
    url,
    image: previewURL,
    body: `
      <h1><span class="name">${escapeHtml(name)}</span></h1>
      <img class="avatar" src="${escapeHtml(displayURI)}" alt="${escapeHtml(name)}'s avatar" />
      <div class="note">
        <strong>This is not an NFT avatar.</strong> The <code>avatar</code>
        record points at an image directly, so there is no token behind it: no
        chain, no contract, no owner, and nothing that can be verified onchain.
        It is just a picture at a URL, and it disappears if that URL does.
      </div>
      ${detailBlock([
        ["Name", name],
        ["Avatar record", ref.record],
        ["Resolved to", displayURI !== ref.uri ? displayURI : null],
        ["Address", resolution.address],
      ])}`,
  });
}

/** The avatar record exists but is in a form nobody has defined. */
function unknownAvatarPage(
  url: string,
  resolution: EnsResolution,
  record: string
): Response {
  const name = resolution.name;
  return shell({
    title: `${name}'s avatar is not readable`,
    description: `${name} has an avatar record in an unrecognised format.`,
    url,
    image: `${new URL(url).origin}/static/ens-unknown.png`,
    body: `
      <h1><span class="name">${escapeHtml(name)}</span> has an unreadable avatar</h1>
      <p>The <code>avatar</code> record is set, but it is not a URI scheme
      ENSIP-12 defines, and not an NFT reference either.</p>
      <div class="note">
        <strong>Expected one of:</strong> <code>https://</code>,
        <code>ipfs://</code>, <code>data:</code>, or an NFT written as
        <code>eip155:&lt;chain&gt;/erc721:&lt;contract&gt;/&lt;tokenId&gt;</code>
        (or <code>erc1155:</code>).
      </div>
      ${detailBlock([
        ["Name", name],
        ["Avatar record", record],
        ["Address", resolution.address],
      ])}`,
  });
}

export async function ensPage(
  env: any,
  request: Request,
  name: string,
  returnScreenshot = false
): Promise<Response> {
  const url = request.url;
  const origin = new URL(url).origin;

  let resolution: EnsResolution;
  try {
    resolution = await resolveEns(env, name);
  } catch (err: any) {
    return errorPage("blockchain", err, { origin, ensName: name });
  }

  if (!resolution.owner && !resolution.resolver) {
    return noAvatarPage(url, resolution, "unregistered");
  }
  if (!resolution.resolver) {
    return noAvatarPage(url, resolution, "no-resolver");
  }

  const ref = parseAvatarRecord(resolution.record);

  switch (ref.kind) {
    case "none":
      return noAvatarPage(url, resolution, "no-record");

    case "nft":
      // The record IS the path this service already serves, so hand straight
      // over to the normal token pipeline. It is told where it came from, so
      // the page can show the token's permanent address and refuse caching.
      return tokenPage(
        env,
        request,
        ref.standard,
        ref.chainId,
        ref.contract,
        ref.tokenID,
        returnScreenshot,
        { ensName: name, noStore: true }
      );

    case "image":
      return imageAvatarPage(env, request, url, resolution, ref);

    default:
      return unknownAvatarPage(url, resolution, ref.record);
  }
}
