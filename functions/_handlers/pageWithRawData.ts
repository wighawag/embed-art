import { ContractMetadata, CorsStatus, Metadata } from "../_utils/metadata";

export async function pageWithRawData(
  token: { contract: string; id: string },
  tokenURI: string,
  contractMetadata: ContractMetadata,
  //   contractURI: string, TODO
  extra: {
    url: string;
    previewURL: string;
    tokenURIBase64Encoded?: string;
    cors?: CorsStatus;
    /** the permanent eip155: address of this token, whatever path got here */
    canonical?: string;
    /** set when the visitor arrived via an ENS name's avatar record */
    ensName?: string;
    /** ENS-derived pages must not be cached: the record can change */
    noStore?: boolean;
  },
  metadata?: Metadata,
): Promise<Response> {
  const url = extra.url;
  // og:url should be the canonical address, not whichever alias was followed.
  const canonical = extra.canonical || url;
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
        <link rel="canonical" href="${canonical}">
        <meta property="og:type" content="website">
        <meta property="og:url" content="${canonical}">
        <meta property="og:title" content="${title}">
        ${
          description
            ? `<meta property="og:description" content="${description}">`
            : ""
        }
        <meta property="og:image" content="${preview}">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:url" content="${canonical}">
        <meta name="twitter:title" content="${title}">
        ${
          description
            ? `<meta name="twitter:description" content="${description}">`
            : ""
        }
        <meta name="twitter:image" content="${preview}">
        <style>
        html {
          background-color: #111111;
          color: wheat;
        }
        * {
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

        .error {
          margin-bottom: 2em;
          color: #FF3333;
        }

        /* ':' and '<' shape into one cluster in monospace faces with
           contextual alternates, and the cluster takes the colour of whichever
           run it ends in. That hid the colon in things like erc721:<contract>. */
        * {
          font-variant-ligatures: none;
          font-feature-settings: "liga" 0, "calt" 0, "dlig" 0;
        }

        .notice {
          max-width: 42em;
          margin: 0 auto 2em;
          padding: 1em 1.2em;
          border: 1px solid #2A2620;
          border-left: 3px solid #BE8F04;
          border-radius: 6px;
          text-align: left;
          font-size: 0.85em;
          opacity: 0.9;
          line-height: 1.6;
        }
        .notice strong { color: #BE8F04; font-weight: normal; }
        .notice code { color: #BE8F04; word-break: break-all; }

        .canonical {
          max-width: 42em;
          margin: 2.5em auto 2em;
          padding-top: 1.2em;
          border-top: 1px solid #2A2620;
          font-size: 0.78em;
          opacity: 0.55;
          text-align: left;
          line-height: 1.7;
        }
        .canonical a { color: #BE8F04; word-break: break-all; }
        .canonical .label { display: block; opacity: 0.75; }

        #nft-iframe {
          min-width: 80vw;
          min-height: 80vh;
        }

      </style>
    </head>
    <body>
      <div id="wrapper">

        ${
          title
            ? `<h1 id="nft-title">${title}</h1>`
            : `<h1 id="nft-title" style="display:none;"></h1>`
        }
        <p id="nft-error" class="error" style="display:none;"></p>
        <p id="global-error" class="error" style="display:none;"></p>
        <div id="cors-notice" class="notice" style="display:none;"></div>
        ${
          extra.canonical
            ? `<div class="canonical">${
                extra.ensName
                  ? `<span class="label">Shown because it is <strong>${extra.ensName}</strong>'s ENS avatar. That record can be changed at any time; this token cannot:</span>`
                  : `<span class="label">Permanent address for this token:</span>`
              }<a href="${extra.canonical}">${extra.canonical}</a></div>`
            : ""
        }
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
        // What the SERVER learned fetching this very metadata URL. A browser
        // cannot tell a CORS rejection from a dead connection, but we made the
        // identical request and read the response headers, so this page never
        // has to guess out loud in front of the visitor.
        const CORS = ${JSON.stringify(extra.cors || "unknown")};
        const PREVIEW = ${JSON.stringify(extra.previewURL || "")};

        const showNotice = (html) => {
          const el = document.getElementById('cors-notice');
          el.innerHTML = html;
          el.style.display = 'block';
        };

        // The artwork could not be loaded in the browser, but the preview we
        // rendered server-side is perfectly good. Show that rather than
        // nothing, and be explicit about what the visitor is looking at.
        const showServerPreview = () => {
          if (!PREVIEW) return;
          const img = document.getElementById('nft-image');
          img.src = PREVIEW;
          img.style.display = 'inline-block';
        };

        const cssURLEscaped = (uri) => {
          return uri.replace(regex, "\\/");
        };
        
        const showError = (error) => {
          const errorElement = document.getElementById('nft-error');
          errorElement.innerHTML = error;
          errorElement.style.display='block';
        }
        const showGlobalError = (error) => {
          const errorElement = document.getElementById('global-error');
          errorElement.innerHTML = error;
          errorElement.style.display='block';
        }
        window.onerror = showGlobalError;
        // Some on-chain WAV generators (e.g. The Bleep Machine earliy demo on
        //  Goerli) write the RIFF and data chunk size fields as 0. Chrome 
        // tolerates this and plays the trailing bytes, but Firefox's stricter
        // demuxer honors the declared 0 length and produces silence. We patch 
        // those header fields here so the audio plays in every browser.
        // Returns a Blob URL when fixed, otherwise the original url untouched.
        function fixMalformedWav(url) {
          var prefix = 'data:audio/wav;base64,';
          if (url.indexOf(prefix) !== 0) return url;
          var b64 = url.slice(prefix.length);
          var bin;
          try { bin = atob(b64); } catch (e) { return url; }
          if (bin.substr(0,4) !== 'RIFF' || bin.substr(8,4) !== 'WAVE') return url;
          var len = bin.length;
          var bytes = new Uint8Array(len);
          for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
          var dv = new DataView(bytes.buffer);
          var riffSize = dv.getUint32(4, true);
          var off = 12, dataOff = 0, dataSize = 0;
          while (off + 8 <= len) {
            var id = String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]);
            var sz = dv.getUint32(off+4, true);
            if (id === 'data') { dataOff = off + 8; dataSize = sz; break; }
            off += 8 + sz + (sz & 1); // chunks are word-aligned
          }
          if (riffSize !== 0 && dataSize !== 0) return url; // already well-formed
          dv.setUint32(4, len - 8, true);            // RIFF chunk size
          if (dataOff) dv.setUint32(dataOff - 4, len - dataOff, true); // data chunk size
          return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        }
        async function fetchImage(tokenURI) {
          let metadataURLToFetch = tokenURI;
          if (metadataURLToFetch.startsWith('ipfs://')) {
            metadataURLToFetch = 'https://ipfs.io/ipfs/' + tokenURI.slice(7);
          }
          let metadataResponse;
          try {
            metadataResponse = await fetch(metadataURLToFetch);
          } catch(err) {
            if (CORS === 'blocked') {
              // Not a guess: our server fetched this same URL and the response
              // carried no Access-Control-Allow-Origin header.
              showNotice(
                "<strong>The artwork below was rendered by Embed.Art, not by your browser.</strong>" +
                "<p>This token's metadata server does not send an " +
                "<code>Access-Control-Allow-Origin</code> header, so browsers refuse to " +
                "read it from another site. This page renders tokens client-side on " +
                "purpose, so it cannot show you the live artwork.</p>" +
                "<p>The preview card that unfurls on social platforms is unaffected: " +
                "we generate it server-side, where CORS does not apply.</p>" +
                "<p>Only the project can fix this, by allowing cross-origin reads on " +
                "<code>" + metadataURLToFetch + "</code>.</p>"
              );
              showServerPreview();
            } else if (tokenURI.startsWith('http') && err.response === undefined) {
              showError("<h2>Could not fetch token's metadata.</h2><p>" +
                "The request failed before any response arrived. Our server could " +
                "reach this metadata URL, so this is most likely your connection " +
                "or a network in between.</p>");
              showServerPreview();
            } else {
              showError("<h2>Could not fetch token's metadata.</h2><p>" + (err.message || err) + "</p>");
              showServerPreview();
            }
            return;
          }
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
                imageURI = 'https://ipfs.io/ipfs/'  + imageURI.slice(7);
            }
            const img = document.getElementById('nft-image');
            img.src=imageURI;
            img.style.display='inline-block';
          }

          if (audioURL) {
            const audio = document.getElementById('nft-audio');
            audio.src = fixMalformedWav(audioURL);
            audio.style.display='inline-block';
          }
        }
        fetchImage(tokenURI);
      </script>
    </body>
</html>`;
  const headers: Record<string, string> = { "content-type": "text/html" };
  if (extra.noStore) {
    // An ENS name points wherever its owner currently says. Caching that
    // mapping would serve yesterday's avatar; the token behind it is still
    // cached normally, keyed by its own URI.
    headers["cache-control"] = "no-store";
  }
  return new Response(page, { headers });
}
