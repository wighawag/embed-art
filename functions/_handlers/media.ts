/**
 * Direct media routes.
 *
 *   /image/eip155:<chain>/erc721:<contract>/<id>   -> the generated preview JPEG
 *   /audio/eip155:<chain>/erc721:<contract>/<id>   -> the token's audio, if any
 *
 * `/image/` exists because the preview's real URL embeds sha256(tokenURI),
 * which nothing outside this worker can compute. Without it a preview can only
 * be found by scraping the page's og:image, so it cannot be used as somebody
 * else's og:image, nor as a thumbnail on our own home page.
 */
import { Metadata, parseMetadata, TokenStandard } from "../_utils/metadata";
import { fetchFirstAvailable } from "../_utils/request";
import { sha256 } from "../_utils/strings";
import { candidateURIs } from "../_utils/url";
import { generatePreviewImage, getFreshData, parseMaxAge } from "./token";

/**
 * A response lifetime, shortened when the request carried `?maxAge` so that
 * no cache holds the answer past the freshness the link asked for. `ttl` is
 * undefined when it did not, and the lifetime is then exactly what it was.
 */
function lifetime(normal: number, ttl: number | undefined): number {
  return ttl === undefined ? normal : Math.min(normal, ttl);
}

/**
 * Redirect with an explicit cache lifetime. Response.redirect() cannot carry
 * headers, and an uncached redirect means every home-page view re-attempts the
 * metadata fetch for tokens whose servers are down, which is exactly the slow
 * path we do not want to repeat.
 */
function redirect(location: string, maxAge: number): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": `public, max-age=${maxAge}`,
    },
  });
}

/** Errors here must still render something, so callers get a placeholder. */
function placeholder(
  origin: string,
  kind: string,
  ttl?: number
): Response {
  // Short: a dead metadata server may come back.
  return redirect(`${origin}/static/error-${kind}.png`, lifetime(300, ttl));
}

export async function imageRoute(
  env: any,
  request: Request,
  standard: TokenStandard,
  chainId: string,
  contract: string,
  tokenID: string
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const maxAge = parseMaxAge(request.url);

  let data;
  let ttl: number | undefined;
  try {
    ({ data, ttl } = await getFreshData(
      env,
      chainId,
      contract,
      tokenID,
      standard,
      false,
      maxAge
    ));
  } catch {
    return placeholder(origin, "blockchain", maxAge);
  }

  let metadata: Metadata;
  try {
    metadata = await parseMetadata(data.tokenURI);
  } catch {
    return placeholder(origin, "metadata", ttl);
  }

  try {
    const uriHash = await sha256(data.tokenURI);
    const imageID =
      `${chainId}_${contract}_${tokenID}`.toLowerCase() + `_${uriHash}.jpg`;
    const url = await generatePreviewImage(
      env,
      request,
      imageID,
      data.tokenURI,
      metadata,
      { number: "" + data.block.number, hash: data.block.hash }
    );
    // The target embeds sha256(tokenURI), so it changes if the token does.
    return redirect(url, lifetime(3600, ttl));
  } catch {
    return placeholder(origin, "screenshot", ttl);
  }
}

const AUDIO_TYPES: [RegExp, string][] = [
  [/\.wav$/i, "audio/wav"],
  [/\.mp3$/i, "audio/mpeg"],
  [/\.ogg$/i, "audio/ogg"],
  [/\.m4a$/i, "audio/mp4"],
  [/\.flac$/i, "audio/flac"],
];

export function audioSource(metadata: Metadata): string | null {
  const url = metadata.animation_url;
  if (!url) return null;
  if (url.startsWith("data:audio/")) return url;
  if (AUDIO_TYPES.some(([re]) => re.test(url))) return url;
  return null;
}

export async function audioRoute(
  env: any,
  request: Request,
  standard: TokenStandard,
  chainId: string,
  contract: string,
  tokenID: string
): Promise<Response> {
  let data;
  let ttl: number | undefined;
  let metadata: Metadata;
  try {
    ({ data, ttl } = await getFreshData(
      env,
      chainId,
      contract,
      tokenID,
      standard,
      false,
      parseMaxAge(request.url)
    ));
    metadata = await parseMetadata(data.tokenURI);
  } catch (err: any) {
    return new Response(`could not read token: ${err.message}`, {
      status: 502,
    });
  }

  const source = audioSource(metadata);
  if (!source) {
    return new Response("this token has no audio", { status: 404 });
  }

  // Immutable per token URI, so it is safe to cache hard; but this address
  // is per TOKEN, so under ?maxAge it may only be cached as long as allowed.
  const headers: Record<string, string> = {
    "cache-control":
      ttl === undefined
        ? "public, max-age=31536000, immutable"
        : `public, max-age=${ttl}`,
    "access-control-allow-origin": "*",
  };

  if (source.startsWith("data:")) {
    const comma = source.indexOf(",");
    const meta = source.slice(5, comma);
    const isBase64 = meta.endsWith(";base64");
    const contentType = (isBase64 ? meta.slice(0, -7) : meta) || "audio/wav";
    const payload = source.slice(comma + 1);
    let body: BodyInit;
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      body = bytes;
    } else {
      body = decodeURIComponent(payload);
    }
    return new Response(body, {
      headers: { ...headers, "content-type": contentType },
    });
  }

  const sources = candidateURIs(source);
  const upstream = sources[0];
  const { response, last } = await fetchFirstAvailable(sources);
  if (!response) {
    return new Response(
      `audio source returned ${last ? last.status : "no answer"}`,
      { status: 502 }
    );
  }
  const guessed =
    AUDIO_TYPES.find(([re]) => re.test(upstream))?.[1] || "application/octet-stream";
  return new Response(response.body, {
    headers: {
      ...headers,
      "content-type": response.headers.get("content-type") || guessed,
    },
  });
}
