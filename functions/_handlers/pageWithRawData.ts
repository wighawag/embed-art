import { ContractMetadata, Metadata } from "../_utils/metadata";

export async function pageWithRawData(
  token: { contract: string; id: string },
  tokenURI: string,
  contractMetadata: ContractMetadata,
  //   contractURI: string, TODO
  extra: { url: string; previewURL: string; tokenURIBase64Encoded?: string },
  metadata?: Metadata
): Promise<Response> {
  const url = extra.url;
  const title =
    metadata?.name ||
    (contractMetadata.symbol
      ? `${contractMetadata.symbol} ${token.id}`
      : contractMetadata.name
      ? `${contractMetadata.name} ${token.id}`
      : `Token ${token.id}`);
  const description = metadata?.description;
  const preview = extra.previewURL;

  const page = `<!DOCTYPE html>
<html lang="en">
    <head>
        <title>${title}</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="title" content="${title}">
        ${
          description
            ? `<meta name="description" content="${description}">`
            : ""
        }
        <meta property="og:type" content="website">
        <meta property="og:url" content="${url}">
        <meta property="og:title" content="${title}">
        ${
          description
            ? `<meta property="og:description" content="${description}">`
            : ""
        }
        <meta property="og:image" content="${preview}">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:url" content="${url}">
        <meta name="twitter:title" content="${title}">
        ${
          description
            ? `<meta name="twitter:description" content="${description}">`
            : ""
        }
        <meta name="twitter:image" content="${preview}">
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
        .main {
          width: 30%;
          height: auto;
        }

        @media only screen and (max-width: 1000px) {
          .main {
            width: 60%;
            height: auto;
          }
        }

        @media only screen and (max-width: 600px) {
          .main {
            width: 90%;
            height: auto;
          }
        }

        @media only screen and (max-width: 400px) {
          .main {
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

        #nft-iframe {
          min-width: 80vw;
          min-height: 80vh;
        }

      </style>
    </head>
    <body>
      <div id="wrapper">
        <h1 id="nft-title" style="display:none;"></h1>
        <p id="nft-description" style="display:none;"></p>
          <p>
            <iframe class="main" style="display:none;" id="nft-iframe"></iframe>
          </p>
          <p>
            <img class="main" style="display=none;" id="nft-image"/>
          </p>
          <p><audio id="nft-audio" controls autoplay loop style="display:none;"></audio></p>
      </div>
      
      ${
        tokenURI && !extra.tokenURIBase64Encoded
          ? ""
          : `<script>
          var atobUTF8=function(){"use strict";function h(b){var a=b.charCodeAt(0)<<24,d=k(~a),c=0,f=b.length,e="";if(5>d&&f>=d){a=a<<d>>>24+d;for(c=1;c<d;++c)a=a<<6|b.charCodeAt(c)&63;65535>=a?e+=g(a):1114111>=a?(a-=65536,e+=g((a>>10)+55296,(a&1023)+56320)):c=0}for(;c<f;++c)e+="\\ufffd";return e}var l=Math.log,m=Math.LN2,k=Math.clz32||function(b){return 31-l(b>>>0)/m|0},g=String.fromCharCode,n=atob;return function(b,a){a||"\\u00ef\\u00bb\\u00bf"!==b.substring(0,3)||(b=b.substring(3));return n(b).replace(/[\\xc0-\\xff][\\x80-\\xbf]*/g,
            h)}}() 
          </script>`
      }
      <script>
        const tokenURI = ${
          extra.tokenURIBase64Encoded
            ? `atobUTF8(\`${extra.tokenURIBase64Encoded}\`)`
            : tokenURI
            ? "`" + tokenURI + "`"
            : `atobUTF8(location.hash.slice(1))`
        };
        const regex = /\\//gm;
        const cssURLEscaped = (uri) => {
          return uri.replace(regex, "\\/");
        };
        async function fetchImage(tokenURI) {
          let metadataURLToFetch = tokenURI;
          if (metadataURLToFetch.startsWith('ipfs://')) {
            metadataURLToFetch = 'https://ipfs.io/ipfs/' + tokenURI.slice(7);
          }
          const metadataResponse = await fetch(metadataURLToFetch);
          const metadata = await metadataResponse.json();

          if (metadata.name) {
            const title = document.getElementById('nft-title');
            title.innerHTML = metadata.name; // TODO contract URI symbol + tokenID as fallback
            title.style.display='block';
          }
          if (metadata.description) {
            const description = document.getElementById('nft-description');
            description.innerHTML = metadata.description;
            description.style.display='block';
          }
          
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

          if (iframeURL) {
            const iframe = document.getElementById('nft-iframe');
            iframe.src=iframeURL;
            iframe.style.display='block';
          } else if (metadata.image) {
            let imageURI = metadata.image;
            if (imageURI.startsWith('ipfs://')) {
                imageURI = 'https://ipfs.io/ipfs/'  + tokenURI.slice(7);
            }
            const img = document.getElementById('nft-image');
            img.src=imageURI;
            img.style.display='inline-block';
          }

          if (audioURL) {
            const audio = document.getElementById('nft-audio');
            audio.src=audioURL;
            audio.style.display='inline-block';
          }
        }
        fetchImage(tokenURI);
      </script>
    </body>
</html>`;
  return new Response(page, {
    headers: { "content-type": "text/html" },
  });
}
