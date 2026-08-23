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
import { generatePreviewImage, getData } from "./token";

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
function placeholder(origin: string, kind: string): Response {
  // Short: a dead metadata server may come back.
  return redirect(`${origin}/static/error-${kind}.png`, 300);
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

  let data;
  try {
    data = await getData(env, chainId, contract, tokenID, standard);
  } catch {
    return placeholder(origin, "blockchain");
  }

  let metadata: Metadata;
  try {
    metadata = await parseMetadata(data.tokenURI);
  } catch {
    return placeholder(origin, "metadata");
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
    return redirect(url, 3600);
  } catch {
    return placeholder(origin, "screenshot");
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
  let metadata: Metadata;
  try {
    data = await getData(env, chainId, contract, tokenID, standard);
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

  // Immutable per token URI, so it is safe to cache hard.
  const headers: Record<string, string> = {
    "cache-control": "public, max-age=31536000, immutable",
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
