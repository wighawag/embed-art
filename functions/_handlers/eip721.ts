import {
  BlockchainData,
  fetchBlockchainData,
  parseMetadata,
} from "../_utils/metadata";
import { sha256, toBase64 } from "../_utils/strings";
import { blobToDataURI, getImageUrl } from "../_utils/url";
import { pageWithParsedData } from "./pageWithParsedData";
import { preview } from "./preview";

export async function eip721(
  env: any,
  request: Request,
  chainId: string,
  contract: string,
  tokenID: string,
  onlyPreview: boolean = false
): Promise<Response> {
  try {
    const cacheID = `eip721:${chainId}:${contract}:${tokenID}`.toLowerCase();
    let data: BlockchainData;
    try {
      data = await env.DATA_CACHE.get(cacheID, { type: "json" });
    } catch (err) {
      return new Response(
        `failed to get from DATA_CACHE : ${err.message}\n${err.stack}`,
        { status: 500 }
      );
    }
    if (!data) {
      data = await fetchBlockchainData(env, chainId, contract, tokenID);
      try {
        await env.DATA_CACHE.put(cacheID, JSON.stringify(data));
      } catch (err) {
        return new Response(
          `failed to put in DATA_CACHE : ${err.message}\n${err.stack}`,
          { status: 500 }
        );
      }
    }
    const metadata = await parseMetadata(data.tokenURI);
    const contractMetadata = data.contractMetadata;
    if (!onlyPreview) {
      const uriHash = await sha256(metadata.image);
      const imageID =
        `${chainId}_${contract}_${tokenID}`.toLowerCase() + `_${uriHash}.jpg`;
      const imageURL = getImageUrl(request, imageID);
      let imageHead = await env.IMAGES.head(imageID);
      console.log(imageHead);
      if (!imageHead) {
        let screenshot: { url: string };
        let imageURLToUse = metadata.image;
        if (imageURLToUse.startsWith("http")) {
          try {
            imageURLToUse = await fetch(imageURLToUse)
              .then((v) => v.blob())
              .then((b) => blobToDataURI(b));
          } catch (err) {
            return new Response(
              `failed to get the image : ${err.message}\n${err.stack}`,
              { status: 500 }
            );
          }
        }
        const url = new URL(request.url);
        // const urlToScreenshot = `${url.protocol}//${
        //   url.host
        // }/screenshot/?imageBase64=${toBase64(metadata.image)}`;
        const urlToScreenshot = `${url.protocol}//${
          url.host
        }/screenshot/?hash=true#${toBase64(data.tokenURI)}`;
        console.log({ urlToScreenshot });
        if (env.SCREENSHOT_SERVICE_ENDPOINT) {
          const options = {
            url: urlToScreenshot,
            format: "jpeg",
            width: 824,
            height: 412,
            fresh: true,
            wait_until: "page_loaded",
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
            return new Response(
              `fetch screenshot:\n${formData}\n ${err.message}\n${err.stack}`,
              { status: 500 }
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
          return new Response(JSON.stringify(screenshot, null, 2), {
            status: 500,
          });
        }
        console.log(screenshot.url);
        const downloadResponse = await fetch(screenshot.url);

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
            console.log(`saved`, { imageID, imageURL });
          } catch (err) {
            customMetadata.url = customMetadata.url.replace(
              env.SCREENSHOT_SERVICE_API_KEY,
              "API_KEY"
            );
            return new Response(
              `failed to save screenshot (${JSON.stringify(customMetadata)}): ${
                err.message
              }\n${err.stack}`,
              { status: 500 }
            );
          }
        } else {
          return new Response("Not found (Download Failure)", { status: 404 });
        }
      }
      return pageWithParsedData(
        { contract, id: tokenID },
        metadata,
        contractMetadata,
        {
          url: request.url,
          previewURL: imageURL,
        }
      );
    } else {
      return preview(metadata);
    }
  } catch (err) {
    return new Response(`${err.message}\n${err.stack}`, { status: 500 });
  }
}
