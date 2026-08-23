import { Base64 } from "../_utils/base64";
import {
  BlockchainData,
  CorsStatus,
  erc1155IdHex,
  fetchBlockchainData,
  HttpStatusError,
  isRenderable,
  Metadata,
  parseMetadataWithCors,
  TokenStandard,
} from "../_utils/metadata";
import { fetchFirstAvailable } from "../_utils/request";
import { sha256 } from "../_utils/strings";
import {
  blobToDataURI,
  candidateURIs,
  gatewayPath,
  getImageUrl,
} from "../_utils/url";
import { errorPage } from "./errorPage";
import { pageWithRawData } from "./pageWithRawData";
import { screenshotHTML } from "./screenshotWithAllData";

export async function getData(
  env: any,
  chainId: string,
  contract: string,
  tokenID: string,
  standard: TokenStandard = "erc721"
): Promise<BlockchainData> {
  // The standard is part of the key: the same address can answer both
  // tokenURI() and uri(), and they need not agree.
  const cacheID =
    `${standard}:${chainId}:${contract}:${tokenID}`.toLowerCase();
  let data: BlockchainData;
  try {
    data = await env.DATA_CACHE.get(cacheID, { type: "json" });
  } catch (err) {
    throw new Error(
      `failed to get from DATA_CACHE : ${err.message}\n${err.stack}`
    );
  }
  if (!data) {
    data = await fetchBlockchainData(env, chainId, contract, tokenID, standard);
    try {
      await env.DATA_CACHE.put(cacheID, JSON.stringify(data));
    } catch (err) {
      throw new Error(
        `failed to put in DATA_CACHE : ${err.message}\n${err.stack}`
      );
    }
  }
  return data;
}

export async function generateDataURIForScreenshot(
  tokenURI: string,
  metadata: Metadata
): Promise<string> {
  // Through OUR gateways if it is content-addressed, whichever courier the
  // metadata happened to name, and bounded in time so an image nobody pins
  // fails as a failure rather than as a very long wait.
  const sources = metadata.image ? candidateURIs(metadata.image) : [];
  let imageURLToUse = sources[0];

  let tokenURIToUse = tokenURI;
  if (imageURLToUse && imageURLToUse.startsWith("http")) {
    try {
      const { response, attempts } = await fetchFirstAvailable(sources);
      if (!response) {
        throw new Error(
          attempts.map((a) => `${a.url} -> ${a.outcome}`).join("\n")
        );
      }
      imageURLToUse = await response.blob().then((b) => blobToDataURI(b));
    } catch (err) {
      throw new Error(`failed to get the image : ${err.message}\n${err.stack}`);
    }
    tokenURIToUse = `data:application/json;base64,${Base64.encode(
      JSON.stringify({
        image: imageURLToUse,
        animation_url: metadata.animation_url, // TODO to it for iframe (animation_url)
      })
    )}`;
  }
  return tokenURIToUse;
}

async function getScreenshotHTML(
  data: BlockchainData,
  metadata: Metadata
): Promise<string> {
  // NOTE: we generate data:uri from http url, this is to ensure no fetch is required when generating preview
  const tokenURIToUse = await generateDataURIForScreenshot(
    data.tokenURI,
    metadata
  );
  return screenshotHTML(tokenURIToUse);
}

/**
 * Render a token URI + metadata pair into a cached JPEG preview and return its
 * URL. Shared by the token pages and by ENS avatars that are plain images
 * rather than NFTs, which is why it takes an imageID rather than deriving one.
 */
export async function generatePreviewImage(
  env: any,
  request: Request,
  imageID: string,
  tokenURI: string,
  metadata: Metadata,
  customMetadata: Record<string, string>
): Promise<string> {
  const imageURL = getImageUrl(request, imageID);
  let imageHead = await env.IMAGES.head(imageID);
  if (imageHead) {
    return imageURL;
  }

  if (!env.BROWSER) {
    throw new Error(
      "BROWSER binding is required to generate previews. Add a [browser] binding in wrangler.toml."
    );
  }

  // Generate the self-contained screenshot page HTML (assets are embedded as data-URIs
  // so the headless browser does not need to make any network requests).
  const html = screenshotHTML(
    await generateDataURIForScreenshot(tokenURI, metadata)
  );

  let screenshotResponse: Response;
  try {
    // Use the Cloudflare Browser Run binding (no API token needed — the binding
    // authenticates automatically). Quick Actions /screenshot renders the HTML,
    // waits for the #ready element, and captures a JPEG screenshot at 824x412.
    screenshotResponse = await env.BROWSER.quickAction("screenshot", {
      html,
      viewport: { width: 824, height: 412 },
      waitForSelector: { selector: "#ready", timeout: 30000 },
      screenshotOptions: {
        type: "jpeg",
        omitBackground: true,
      },
    });
  } catch (err) {
    throw new Error(
      `failed to call Browser Run quickAction (screenshot): ${err.message}\n${err.stack}`
    );
  }

  if (screenshotResponse.status !== 200) {
    const errorBody = await screenshotResponse.text();
    throw new Error(
      `Browser Run quickAction (screenshot) returned status ${screenshotResponse.status}: ${errorBody}`
    );
  }

  try {
    const imageBuffer = await screenshotResponse.arrayBuffer();
    await env.IMAGES.put(imageID, imageBuffer, {
      customMetadata,
    });
  } catch (err) {
    throw new Error(
      `failed to save screenshot to R2: ${err.message}\n${err.stack}`
    );
  }

  return imageURL;
}

async function generatePreview(
  env: any,
  request: Request,
  chainId: string,
  contract: string,
  tokenID: string,
  data: BlockchainData,
  metadata: Metadata
): Promise<string | null> {
  const uriHash = await sha256(data.tokenURI);
  // The standard is deliberately NOT part of this key: changing it would
  // orphan every preview already in R2, and the URI hash already separates
  // an erc721 and an erc1155 that share an address.
  const imageID =
    `${chainId}_${contract}_${tokenID}`.toLowerCase() + `_${uriHash}.jpg`;
  return generatePreviewImage(env, request, imageID, data.tokenURI, metadata, {
    number: "" + data.block.number,
    hash: data.block.hash,
  });
}

export async function tokenPage(
  env: any,
  request: Request,
  standard: TokenStandard,
  chainId: string,
  contract: string,
  tokenID: string,
  returnScreenshot = false,
  /** set when this token was reached indirectly, e.g. via an ENS avatar */
  via?: { ensName?: string; noStore?: boolean }
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const ctx = { chainId, contract, tokenID, origin, standard };
  // The permanent address of this token, regardless of which alias was
  // followed to get here: an ENS name, a legacy /erc721/ path, or eip721:.
  const canonical = `${origin}/eip155:${chainId}/${standard}:${contract}/${tokenID}`;
  // Only worth showing when the visitor did NOT arrive by it.
  const arrivedCanonically =
    new URL(request.url).pathname.toLowerCase() ===
    new URL(canonical).pathname.toLowerCase();

  // ------------------------------------------------------------------
  // Stage 1: Blockchain data (RPC node)
  // ------------------------------------------------------------------
  let data: BlockchainData;
  try {
    data = await getData(env, chainId, contract, tokenID, standard);
  } catch (err: any) {
    return errorPage("blockchain", err, ctx);
  }

  // ------------------------------------------------------------------
  // Stage 2: Metadata parsing (tokenURI server)
  // ------------------------------------------------------------------
  let metadata: Metadata;
  let cors: CorsStatus;
  try {
    const result = await parseMetadataWithCors(
      data.tokenURI,
      standard === "erc1155" ? erc1155IdHex(tokenID) : undefined
    );
    metadata = result.metadata;
    cors = result.cors;
  } catch (err: any) {
    // A 404 from the metadata host means the token id does not exist, which
    // is a different story from a host that is down.
    const type =
      err instanceof HttpStatusError && err.status === 404
        ? "notfound"
        : "metadata";
    // "The metadata server may be down" is the wrong story for a CID: there is
    // no server to be down. What happened is that every gateway looked for
    // somebody providing those bytes and nobody was.
    const unpinned =
      type === "metadata" &&
      gatewayPath(data.tokenURI) !== null &&
      !(err instanceof HttpStatusError);
    return errorPage(type, err, {
      ...ctx,
      tokenURI: data.tokenURI,
      message: unpinned
        ? "This token's metadata is content-addressed, and no gateway could find " +
          "anyone still providing it. A hash names which bytes the token means; " +
          "it does not oblige anyone to keep them."
        : undefined,
    });
  }

  // Bail before the browser: with no image and no animation there is nothing
  // for the screenshot to wait on, and it would time out after 30s.
  if (!isRenderable(metadata)) {
    return errorPage(
      "empty",
      new Error("metadata contains neither image nor animation_url"),
      { ...ctx, tokenURI: data.tokenURI }
    );
  }

  const contractMetadata = data.contractMetadata;

  // ------------------------------------------------------------------
  // Stage 3: Screenshot page (for ?showScreenshot debug mode)
  // ------------------------------------------------------------------
  if (returnScreenshot) {
    try {
      const html = await getScreenshotHTML(data, metadata);
      return new Response(html, {
        headers: { "content-type": "text/html" },
      });
    } catch (err: any) {
      return errorPage("image", err, { ...ctx, tokenURI: data.tokenURI });
    }
  }

  // ------------------------------------------------------------------
  // Stage 4: Preview generation (image fetch + Browser Run screenshot)
  // ------------------------------------------------------------------
  let previewURL: string | null;
  try {
    previewURL = await generatePreview(
      env,
      request,
      chainId,
      contract,
      tokenID,
      data,
      metadata
    );
  } catch (err: any) {
    // generateDataURIForScreenshot (inside generatePreview) fetches the
    // image — if that fails it's an image error, not a screenshot error.
    if (err.message.includes("failed to get the image")) {
      return errorPage("image", err, { ...ctx, tokenURI: data.tokenURI });
    }
    return errorPage("screenshot", err, ctx);
  }
  if (!previewURL) {
    return errorPage(
      "screenshot",
      new Error("Screenshot generation returned no result"),
      ctx
    );
  }

  // ------------------------------------------------------------------
  // Stage 5: Return the full NFT page
  // ------------------------------------------------------------------
  return pageWithRawData(
    { contract, id: tokenID },
    data.tokenURI,
    contractMetadata,
    {
      url: request.url,
      previewURL,
      cors,
      canonical,
      showCanonical: !arrivedCanonically,
      ensName: via?.ensName,
      noStore: via?.noStore,
    },
    metadata
  );
}
