import { Base64 } from "../_utils/base64";
import {
  BlockchainData,
  fetchBlockchainData,
  Metadata,
  parseMetadata,
} from "../_utils/metadata";
import { sha256, toBase64 } from "../_utils/strings";
import { blobToDataURI, getImageUrl } from "../_utils/url";
import { pageWithRawData } from "./pageWithRawData";

export async function getData(
  env: any,
  chainId: string,
  contract: string,
  tokenID: string
): Promise<BlockchainData> {
  const cacheID = `eip721:${chainId}:${contract}:${tokenID}`.toLowerCase();
  let data: BlockchainData;
  try {
    data = await env.DATA_CACHE.get(cacheID, { type: "json" });
  } catch (err) {
    throw new Error(
      `failed to get from DATA_CACHE : ${err.message}\n${err.stack}`
    );
  }
  if (!data) {
    data = await fetchBlockchainData(env, chainId, contract, tokenID);
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
  let imageURLToUse = metadata.image;

  let tokenURIToUse = tokenURI;
  if (imageURLToUse && imageURLToUse.startsWith("http")) {
    try {
      imageURLToUse = await fetch(imageURLToUse)
        .then((v) => v.blob())
        .then((b) => blobToDataURI(b));
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

async function getURLToScreenshot(
  request: Request,
  data: BlockchainData,
  metadata: Metadata
): Promise<string> {
  // NOTE: we generate data:uri from http url, this is to ensure no fetch is required when generating preview
  const tokenURIToUse = await generateDataURIForScreenshot(
    data.tokenURI,
    metadata
  );
  const url = new URL(request.url);
  const urlToScreenshot = `${url.protocol}//${
    url.host
  }/screenshot/?hash=true#${toBase64(tokenURIToUse)}`;
  return urlToScreenshot;
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
  const imageID =
    `${chainId}_${contract}_${tokenID}`.toLowerCase() + `_${uriHash}.jpg`;
  const imageURL = getImageUrl(request, imageID);
  let imageHead = await env.IMAGES.head(imageID);
  if (imageHead) {
    return imageURL;
  }

  const urlToScreenshot = await getURLToScreenshot(request, data, metadata);
  let screenshot: { url: string };
  if (env.SCREENSHOT_SERVICE_ENDPOINT) {
    const options = {
      url: urlToScreenshot,
      format: "jpeg",
      width: 824,
      height: 412,
      fresh: true,
      wait_for: "#ready",
      // wait_until: "page_loaded",
      full_page: true,
      response_type: "json",
      access_key: env.SCREENSHOT_SERVICE_API_KEY,
    };
    const formData = new FormData();
    for (const key of Object.keys(options)) {
      formData.append(key, options[key]);
    }

    try {
      screenshot = await fetch(env.SCREENSHOT_SERVICE_ENDPOINT, {
        method: "POST",
        body: formData,
      }).then((v) => v.json());
    } catch (err) {
      formData.delete("access_key");
      throw new Error(
        `fetch screenshot (${urlToScreenshot}):\n${formData}\n ${err.message}\n${err.stack}`
      );
    }
  } else {
    const url = new URL(request.url);
    screenshot = {
      url:
        url.protocol +
        "//" +
        url.host +
        `/static/wighawag.png?url=${urlToScreenshot}`,
    };
  }

  if (!screenshot.url) {
    throw new Error(
      `no url generated: \n${JSON.stringify(screenshot, null, 2)}`
    );
  }
  let downloadResponse;
  try {
    downloadResponse = await fetch(screenshot.url);
  } catch (err) {
    throw new Error(
      `failed to screenshot (${urlToScreenshot}): \n${JSON.stringify(
        screenshot,
        null,
        2
      )}\n${err.message}\n${err.stack}`.replace(
        env.SCREENSHOT_SERVICE_API_KEY,
        "API_KEY"
      )
    );
  }

  if (downloadResponse.status === 200) {
    const customMetadata = {
      ...screenshot,
      ...{
        number: "" + data.block.number,
        hash: data.block.hash,
      },
    };
    try {
      await env.IMAGES.put(imageID, downloadResponse.body, {
        customMetadata,
      });
    } catch (err) {
      customMetadata.url = customMetadata.url.replace(
        env.SCREENSHOT_SERVICE_API_KEY,
        "API_KEY"
      );
      throw new Error(
        `failed to save screenshot (${JSON.stringify(customMetadata)}): ${
          err.message
        }\n${err.stack}`
      );
    }
  } else {
    return null;
  }

  return imageURL;
}

export async function eip721(
  env: any,
  request: Request,
  chainId: string,
  contract: string,
  tokenID: string,
  returnScreenshot = false
): Promise<Response> {
  try {
    const data = await getData(env, chainId, contract, tokenID);
    const metadata = await parseMetadata(data.tokenURI);
    const contractMetadata = data.contractMetadata;

    if (returnScreenshot) {
      const urlToScreenshot = await getURLToScreenshot(request, data, metadata);
      return new Response(`<a href="${urlToScreenshot}">screenshot</a>`, {
        headers: { "content-type": "text/html" },
      });
    }

    // can instead generate an iframe with the screenshot url

    const previewURL = await generatePreview(
      env,
      request,
      chainId,
      contract,
      tokenID,
      data,
      metadata
    );
    if (!previewURL) {
      return new Response("Not found (Download Failure)", { status: 404 });
    }
    return pageWithRawData(
      { contract, id: tokenID },
      data.tokenURI,
      contractMetadata,
      {
        url: request.url,
        previewURL,
        // tokenURIBase64Encoded: data.tokenURIBase64Encoded,
      },
      metadata
    );
  } catch (err) {
    return new Response(`${err.message}\n${err.stack}`, { status: 500 });
  }
}
