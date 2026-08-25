import {
  dataURIPayload,
  encodedDataURI,
  markupKind,
  markupToDataURI,
} from "../_utils/clientCourtesy";
import { backgroundColorOf } from "../_utils/artBackdrop";
import { jsString } from "../_utils/strings";

export function screenshotHTML(
  tokenURI?: string,
  capture?: boolean
): string {
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
      /* The site's plate, not black: this card is the page in miniature, and
         black is also a colour art draws WITH. #img stays transparent so the
         plate (or whatever the art needs behind it) shows through. */
      html, body {
        background-color: #111111;
      }
      html, body, div, iframe {
       margin: 0px; 
       padding: 0px; 
       height: 100%; 
       width: 100%;
       border: none;
      }
      #img { background-color: transparent; }
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
        // Written by JSON.stringify, never pasted between backticks: a token's
        // own text is not our source code. A template literal would also read
        // an escape sequence inside the document (a backslash before an n, as
        // JSON writes a newline) as a real newline, which is enough to make
        // valid JSON unparseable by the time it arrives here.
        const tokenURI = ${
          tokenURI ? jsString(tokenURI) : `atobUTF8(location.hash.slice(1))`
        };
        const regex = /\\//gm;
        const cssURLEscaped = (uri) => {
          return uri.replace(regex, "\\/");
        };
        // The same courtesies the token page extends, because this page IS
        // the preview: whatever renders here is what unfurls on a timeline.
        // See functions/_utils/clientCourtesy.ts for why each one exists.
        const __name = (fn) => fn;
        const dataURIPayload = ${dataURIPayload.toString()};
        const markupKind = ${markupKind.toString()};
        const markupToDataURI = ${markupToDataURI.toString()};
        const encodedDataURI = ${encodedDataURI.toString()};
        const mediaSource = (value) => {
          const kind = markupKind(value);
          if (kind) return markupToDataURI(value, kind);
          // An unencoded data: URI is cut at its first '#' by an <img> and by
          // a CSS url() alike, which is how a whole onchain SVG becomes a
          // blank card.
          return encodedDataURI(value) || value;
        };

        // The card obeys the token: background_color if it declares one, the
        // site's plate otherwise. No sampling, no taste. See artBackdrop.ts.
        const backgroundColorOf = ${backgroundColorOf.toString()};
        const PLATE = '#111111';
        const paintBackdrop = (metadata) => {
          const declared = backgroundColorOf(metadata) || PLATE;
          document.documentElement.style.backgroundColor = declared;
          document.body.style.backgroundColor = declared;
        };

        // #ready is the shutter: the renderer screenshots the moment it
        // appears. So it must not appear until the art has actually painted.
        // It used to be created 200ms after the SOURCE WAS ASSIGNED, which is
        // a race the art loses as soon as it is big: a 13KB inline SVG or a
        // 1MB html animation both photographed as a black rectangle.
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

        // Whatever happens, produce a card. Waiting for a load event that
        // never arrives would burn the renderer's whole 30s budget and return
        // nothing at all, which is worse than an imperfect picture.
        setTimeout(signalReady, 12000);
        async function fetchImage(tokenURI) {
          let metadataURLToFetch = tokenURI;
          if (metadataURLToFetch.startsWith('ipfs://')) {
            metadataURLToFetch = 'https://ipfs.io/ipfs/' + tokenURI.slice(7);
          }
          let metadata;
          try {
            const metadataResponse = await fetch(metadataURLToFetch);
            metadata = await metadataResponse.json();
          } catch (err) {
            // A data: URI that was never percent-encoded loses everything past
            // its first '#' when fetched as a URL. Read it as a string instead
            // rather than let the render die on a card nobody can fix.
            const payload = dataURIPayload(tokenURI);
            if (!payload) throw err;
            metadata = JSON.parse(payload);
          }
                
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
            // An html artwork is a program: loaded is not the same as drawn,
            // so give it a moment to run before the shutter opens.
            iframe.addEventListener('load', () => setTimeout(signalReady, 1500), { once: true });
            iframe.addEventListener('error', signalReady, { once: true });
            iframe.src = mediaSource(iframeURL);
            iframe.style.display='block';
          } else if (metadata.image) {
            let source = mediaSource(metadata.image);
            if (source.startsWith('ipfs://')) {
              source = 'https://ipfs.io/ipfs/'  + source.slice(7);
            }
            const elem = document.getElementById('img');
            // Decoded through an Image first: its load event is the only
            // honest signal that a background-image has something to draw.
            paintBackdrop(metadata);
            const probe = new Image();
            probe.addEventListener('load', signalReady, { once: true });
            probe.addEventListener('error', signalReady, { once: true });
            probe.src = source;
            elem.style.backgroundImage =
              'url("' + (source.startsWith('data:') ? cssURLEscaped(source) : source) + '")';
          } else {
            signalReady();
          }
        }
        // Without this the renderer waits the full 30s for a #ready that a
        // thrown promise will never create, and a broken token costs half a
        // minute to report as "preview generation failed".
        fetchImage(tokenURI).catch(() => signalReady());
      </script>
      ${capture ? captureInjection : ""}
    </body>
</html>`;
  return page;
}

export async function screenshotWithAllData(
  tokenURI?: string,
  capture?: boolean
): Promise<Response> {
  const page = screenshotHTML(tokenURI, capture);
  return new Response(page, {
    headers: { "content-type": "text/html" },
  });
}
