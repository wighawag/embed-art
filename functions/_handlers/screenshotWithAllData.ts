export async function screenshotWithAllData(
  tokenURI?: string,
  capture?: boolean
): Promise<Response> {
  const captureInjection = `
  <script>
      const options = {
        video: {
          cursor: "never",
          displaySurface: "browser",
          preferCurrentTab: true,
        },
      };

      function draw(video) {
        let canvas = document.createElement("canvas");
        video.width = canvas.width = video.videoWidth;
        video.height = canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);

        video.srcObject.getTracks().forEach((track) => track.stop());
        video.srcObject = null;

        return canvas;
      }
      async function toCanvas() {
        let stream = await navigator.mediaDevices.getDisplayMedia(options);
        let video = document.createElement("video");
        video.srcObject = stream;
        video.play();

        return new Promise((resolve) => {
          video.addEventListener(
            "canplay",
            (e) => {
              let canvas = draw(video);
              resolve(canvas);
            },
            { once: true }
          );
        });
      }
      async function toDataURL(...args) {
        let canvas = await toCanvas();
        return canvas.toDataURL(...args);
      }

      async function toBlob(...args) {
        let canvas = await toCanvas();
        return new Promise((resolve) => canvas.toBlob(resolve, ...args));
      }

      async function capture() {
        const btn = document.getElementById("btn");
        btn.style.display = "none";

        const url = await toDataURL();
        const img = document.createElement("img");
        // img.style = "border: 5px red solid";
        img.src = url;
        while (document.body.firstChild) {
          document.body.removeChild(document.body.firstChild);
        }
        document.body.appendChild(img);
      }
    </script>
    <div
      style="
        width: 100%;
        height: 100%;
        position: absolute;
        background-color: transparent;
        text-align: center;
      "
    >
      <button
        id="btn"
        onclick="capture()"
        style="
          width: 200px;
          border-radius: 10em;
          margin-top: 10px;
          background-color: #4caf50;
          box-shadow: 4px 4px 5px #333333;
          border: none;
          color: white;
          padding: 15px 32px;
          text-align: center;
          text-decoration: none;
          display: inline-block;
          font-size: 16px;

          margin-right: auto;
          margin-left: auto;
        "
      >
        capture
      </button>
    </div>
  `;
  const page = `<!DOCTYPE html>
<html lang="en">
    <head>
        <title>Screenshot</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      html {overflow: auto;}
      html, body, div, iframe {
        background-color: black;
       margin: 0px; 
       padding: 0px; 
       height: 100%; 
       width: 100%;
       border: none;
      }
      iframe {
        position: absolute;
        top: 5vh;
        left: 5vw;
        margin: auto;
        height: 90vh;
        width: 90vw;
      }
      #img {
        position: absolute;
        top: 5vh;
        left: 5vw;
        margin: auto;
        background-position: center center;
        background-repeat: no-repeat;
        background-size: contain;
        height: 90vh;
        width: 90vw;
      }
    </style>
    </head>
    <body>
      <div id="img"></div>
      <iframe id="nft-iframe" style="display:none;"></iframe>
      ${
        tokenURI
          ? ""
          : `<script>
          var atobUTF8=function(){"use strict";function h(b){var a=b.charCodeAt(0)<<24,d=k(~a),c=0,f=b.length,e="";if(5>d&&f>=d){a=a<<d>>>24+d;for(c=1;c<d;++c)a=a<<6|b.charCodeAt(c)&63;65535>=a?e+=g(a):1114111>=a?(a-=65536,e+=g((a>>10)+55296,(a&1023)+56320)):c=0}for(;c<f;++c)e+="\\ufffd";return e}var l=Math.log,m=Math.LN2,k=Math.clz32||function(b){return 31-l(b>>>0)/m|0},g=String.fromCharCode,n=atob;return function(b,a){a||"\\u00ef\\u00bb\\u00bf"!==b.substring(0,3)||(b=b.substring(3));return n(b).replace(/[\\xc0-\\xff][\\x80-\\xbf]*/g,
            h)}}() 
          </script>`
      }
      <script>
        const tokenURI = ${
          tokenURI ? "`" + tokenURI + "`" : `atobUTF8(location.hash.slice(1))`
        };
        const regex = /\\//gm;
        const cssURLEscaped = (uri) => {
          return uri.replace(regex, "\\/");
        };
        const signalReady = () => {
          let ready = document.getElementById('ready');
          if (!ready) {
            setTimeout(() => {
              ready = document.getElementById('ready');
              if (!ready) {
                ready = document.createElement('div');
                ready.id = 'ready';
                document.body.appendChild(ready);
              }
            }, 200);
          }
        }
        async function fetchImage(tokenURI) {
          let metadataURLToFetch = tokenURI;
          if (metadataURLToFetch.startsWith('ipfs://')) {
            metadataURLToFetch = 'https://ipfs.io/ipfs/' + tokenURI.slice(7);
          }
          const metadataResponse = await fetch(metadataURLToFetch);
          const metadata = await metadataResponse.json();
                
          let iframeURL;
          if (
            metadata.animation_url &&
            (metadata.animation_url.startsWith("data:text/html") ||
              metadata.animation_url.endsWith(".html")) // TODO more ?
          ) {
            iframeURL = metadata.animation_url;
          }
        
          if (iframeURL) {
            const img = document.getElementById('img');
            img.style.display = 'none';

            const iframe = document.getElementById('nft-iframe');
            iframe.src=iframeURL;
            iframe.style.display='block';
            signalReady();
          } else if (metadata.image) {
            let cssImage = metadata.image;
            if (cssImage.startsWith('ipfs://')) {
              cssImage = 'https://ipfs.io/ipfs/'  + cssImage.slice(7);
            } else if (cssImage.startsWith('data:')) {
              cssImage = cssURLEscaped(cssImage);
            }
            const elem = document.getElementById('img');
            elem.style.backgroundImage = 'url("' + cssImage + '")';
            signalReady();
          }
        }
        fetchImage(tokenURI);
      </script>
      ${capture ? captureInjection : ""}
    </body>
</html>`;
  return new Response(page, {
    headers: { "content-type": "text/html" },
  });
}
