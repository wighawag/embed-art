import { fetchMetadata } from "../_utils/metadata";
import { sha256, toBase64 } from "../_utils/strings";
import { blobToDataURI, getImageUrl } from "../_utils/url";
import { page } from "./page";
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
    let data;
    try {
      data = await env.DATA_CACHE.get(cacheID, { type: "json" });
    } catch (err) {
      return new Response(
        `failed to get from DATA_CACHE : ${err.message}\n${err.stack}`,
        { status: 500 }
      );
    }
    if (!data) {
      data = await fetchMetadata(env, chainId, contract, tokenID);
      try {
        await env.DATA_CACHE.put(cacheID, JSON.stringify(data));
      } catch (err) {
        return new Response(
          `failed to put in DATA_CACHE : ${err.message}\n${err.stack}`,
          { status: 500 }
        );
      }
    }
    const metadata = data.metadata;
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
        const urlToScreenshot = `${url.protocol}//${
          url.host
        }/screenshot/?imageBase64=${toBase64(metadata.image)}`;
        console.log({ urlToScreenshot });
        if (env.SCREENSHOT_SERVICE) {
          const screenshotRequest = `${env.SCREENSHOT_SERVICE}&url=${urlToScreenshot}&format=jpeg&width=824&height=412&fresh=true&wait_until=page_loaded&full_page=true&response_type=json`;
          try {
            screenshot = await fetch(screenshotRequest).then((v) => v.json());
          } catch (err) {
            // TODO get rid of that second trial
            //  the screenshot service we use seems to have a limit in the url length that prevent the use of data uri trick
            console.log(
              `failed to fetch screenshot first time, retrying with preview URL \n ${err.message}\n${err.stack}`
            );
            const urlToScreenshot = `${request.url}/preview`;
            const screenshotRequest = `${env.SCREENSHOT_SERVICE}&url=${urlToScreenshot}&format=jpeg&width=824&height=412&fresh=true&wait_until=page_loaded&full_page=true&response_type=json`;
            try {
              screenshot = await fetch(screenshotRequest).then((v) => v.json());
            } catch (err) {
              return new Response(
                `fetch screenshot:\n${screenshotRequest.slice(
                  env.SCREENSHOT_SERVICE.length
                )}\n ${err.message}\n${err.stack}`,
                { status: 500 }
              );
            }
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
      return page({ contract, id: tokenID }, metadata, contractMetadata, {
        url: request.url,
        previewURL: imageURL,
      });
    } else {
      return preview(metadata);
    }
  } catch (err) {
    return new Response(`${err.message}\n${err.stack}`, { status: 500 });
  }
}
