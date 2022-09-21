import { fetchMetadata } from "../_utils/metadata";
import { getImageUrl } from "../_utils/url";
import { page } from "./page";
import { preview } from "./preview";

// from https://gist.github.com/jonleighton/958841
function base64ArrayBuffer(arrayBuffer) {
  var base64 = "";
  var encodings =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  var bytes = new Uint8Array(arrayBuffer);
  var byteLength = bytes.byteLength;
  var byteRemainder = byteLength % 3;
  var mainLength = byteLength - byteRemainder;

  var a, b, c, d;
  var chunk;

  // Main loop deals with bytes in chunks of 3
  for (var i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048) >> 12; // 258048   = (2^6 - 1) << 12
    c = (chunk & 4032) >> 6; // 4032     = (2^6 - 1) << 6
    d = chunk & 63; // 63       = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder == 1) {
    chunk = bytes[mainLength];

    a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3) << 4; // 3   = 2^2 - 1

    base64 += encodings[a] + encodings[b] + "==";
  } else if (byteRemainder == 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

    a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008) >> 4; // 1008  = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15) << 2; // 15    = 2^4 - 1

    base64 += encodings[a] + encodings[b] + encodings[c] + "=";
  }

  return base64;
}

async function sha256(v: string): Promise<string> {
  const myText = new TextEncoder().encode(v);
  const myDigest = await crypto.subtle.digest(
    {
      name: "SHA-256",
    },
    myText
  );

  return base64ArrayBuffer(myDigest);
}

export async function eip721(
  env: any,
  request: Request,
  chainId: string,
  contract: string,
  tokenID: string,
  onlyPreview: boolean = false
): Promise<Response> {
  try {
    const cacheID = `eip721:${chainId}:${contract}:${tokenID}`;
    let data = await env.DATA_CACHE.get(cacheID, { type: "json" });
    if (!data) {
      data = await fetchMetadata(env, chainId, contract, tokenID);
      await env.DATA_CACHE.put(cacheID, JSON.stringify(data));
    }
    const metadata = data.metadata;
    const contractMetadata = data.contractMetadata;
    if (!onlyPreview) {
      const imageID = (await sha256(metadata.image)) + ".jpg";
      const imageURL = getImageUrl(request, imageID);
      let imageHead = await env.IMAGES.head(imageID);
      console.log(imageHead);
      if (!imageHead) {
        let screenshot: { url: string };
        if (env.SCREENSHOT_SERVICE) {
          try {
            screenshot = await fetch(
              `${env.SCREENSHOT_SERVICE}&url=${request.url}/preview&format=jpeg&width=824&height=412&fresh=true&wait_until=page_loaded&full_page=true&response_type=json`
            ).then((v) => v.json());
          } catch (err) {
            return new Response(
              `fetch screenshot : ${err.message}\n${err.stack}`,
              { status: 500 }
            );
          }
        } else {
          const url = new URL(request.url);
          screenshot = {
            url: url.protocol + "//" + url.host + "/static/wighawag.png",
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
          await env.IMAGES.put(imageID, downloadResponse.body, {
            customMetadata: { ...screenshot, ...data.block },
          });
          console.log(`saved`, { imageID, imageURL });
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
