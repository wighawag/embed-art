import { Metadata } from "../_utils/metadata";

export async function page(
  token: { contract: string; id: string },
  metadata: Metadata,
  extra: { url: string; previewURL: string }
): Promise<Response> {
  const url = extra.url;
  const title = metadata.name;
  const description = metadata.description;
  const preview = extra.previewURL;
  const image = metadata.image;
  let iframeURL;
  if (
    metadata.animation_url &&
    (metadata.animation_url.startsWith("data:text/html") ||
      metadata.animation_url.endsWith(".html")) // TODO more ?
  ) {
    iframeURL = metadata.animation_url;
  }
  let audioURL;
  if (
    metadata.animation_url &&
    (metadata.animation_url.startsWith("data:audio/") ||
      metadata.animation_url.endsWith(".wav") ||
      metadata.animation_url.endsWith(".mp3") ||
      metadata.animation_url.endsWith(".ogg")) // TODO more
  ) {
    audioURL = metadata.animation_url;
  }
  const page = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="title" content="${title}">
    <meta name="description" content="${description}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${preview}">
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="${url}">
    <meta property="twitter:title" content="${title}">
    <meta property="twitter:description" content="${description}">
    <meta property="twitter:image" content="${preview}">
    <style>
      * {
        background-color: #111111;
        color: wheat;
        margin: 0;
        padding: 0;
        font-family: Hack, monospace;
      }
      p,
      h1 {
        margin: 1em 1em 1em 1em;
      }
      :root {
        --width: 80vw;
      }
      #wrapper {
        text-align: center;
        height: 100%;
        margin: 0;
      }
      #nft-image {
        width: 30%;
        height: auto;
      }

      @media only screen and (max-width: 1000px) {
        #nft-image {
          width: 60%;
          height: auto;
        }
      }

      @media only screen and (max-width: 600px) {
        #nft-image {
          width: 90%;
          height: auto;
        }
      }

      @media only screen and (max-width: 400px) {
        #nft-image {
          width: 100%;
          height: auto;
        }
      }

      #nft-title {
        margin-top: 1em;
      }

      #nft-description {
        margin-bottom: 2em;
      }

    </style>
  </head>
  <body>
    <div id="wrapper">
      <h1 id="nft-title">${title}</h1>
      <p id="nft-description">${description}</p>
        <p>
            <img id="nft-image" src="${image}" />
        </p>
        ${
          iframeURL
            ? `<p>
        <div id="nft-iframe-wrapper">
          <iframe id="nft-iframe" src="${iframeURL}"></iframe>
        </div>
      </p>`
            : ""
        }
        ${
          audioURL
            ? `<p><audio id="nft-sound" src="${audioURL}" controls autoplay loop></audio></p>`
            : ""
        }
    </div>
  </body>
</html>
    `;
  return new Response(page, {
    headers: { "content-type": "text/html" },
  });
}
