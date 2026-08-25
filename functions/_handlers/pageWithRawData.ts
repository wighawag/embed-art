import {
  Attribute,
  ContractMetadata,
  CorsStatus,
  Metadata,
} from "../_utils/metadata";
import {
  courtesyEnabled,
  dataURIPayload,
  encodedDataURI,
  markupKind,
  markupToDataURI,
} from "../_utils/clientCourtesy";
import { jsString } from "../_utils/strings";
import {
  backdropStats,
  backgroundColorOf,
  hidesDarkStrokes,
  requestedBackdrop,
  sampleArt,
} from "../_utils/artBackdrop";
import { gatewayPath, imageAttempts } from "../_utils/url";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Where the token keeps the document we just read, said in one phrase. The
 * point of the line is the difference between art that outlives its author and
 * art that outlives only its hosting bill.
 */
function metadataOrigin(tokenURI: string): string | null {
  if (!tokenURI) return null;
  if (tokenURI.startsWith("data:")) return "onchain (data: URI)";
  if (gatewayPath(tokenURI)) return "content-addressed";
  try {
    return new URL(tokenURI).hostname;
  } catch {
    return null;
  }
}

/**
 * Rendered server-side so the traits survive a metadata host that refuses
 * cross-origin reads: the browser cannot fetch it, but we already did. The
 * client re-renders the same list from its own fetch when that succeeds, so
 * the filtering rules here and in renderAttributes must agree.
 */
function attributesHTML(attributes?: Attribute[]): string {
  if (!Array.isArray(attributes)) return "";
  return attributes
    .map((attr) => {
      if (!attr || typeof attr !== "object") return "";
      const value = attr.value;
      if (value === null || value === undefined || value === "") return "";
      if (typeof value === "object") return "";
      const key = attr.trait_type
        ? `<span class="k">${escapeHtml(String(attr.trait_type))}</span>`
        : "";
      return `<li class="attr">${key}<span class="v">${escapeHtml(
        String(value),
      )}</span></li>`;
    })
    .join("");
}

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
    /** false when the visitor is already ON the canonical URL */
    showCanonical?: boolean;
    /** set when the visitor arrived via an ENS name's avatar record */
    ensName?: string;
    /** set when the tokenURI was not used as returned: see _utils/adapters.ts */
    via?: {
      collection: string;
      note: string;
      reason: string;
      source: { address: string; method: string };
    };
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

  // Everything below is written by a contract or by whoever it points at, so
  // none of it reaches the document without being escaped first.
  const escTitle = escapeHtml(title);
  const escDescription = description ? escapeHtml(description) : "";
  const escPreview = escapeHtml(preview || "");
  const escCanonical = escapeHtml(canonical);

  // The collection, said the way a gallery labels a wall: the name, and the
  // ticker only when it adds something the name does not.
  const collection = contractMetadata.name
    ? contractMetadata.symbol
      ? `${contractMetadata.name} (${contractMetadata.symbol})`
      : contractMetadata.name
    : contractMetadata.symbol || "";

  const attrs = attributesHTML(metadata?.attributes);
  const source = metadataOrigin(tokenURI);
  const externalURL =
    metadata?.external_url && /^https?:\/\//i.test(metadata.external_url)
      ? metadata.external_url
      : undefined;

  // The provenance footer: where this token permanently lives, where its
  // document is kept, and where its project can be found. Assembled first so
  // that a token with none of the three does not get a rule under the art with
  // nothing beneath it.
  const rows: string[] = [];
  if (extra.canonical && extra.showCanonical !== false) {
    rows.push(
      `<p class="row canonical">${
        extra.ensName
          ? `<span class="label">Shown because it is <strong>${escapeHtml(
              extra.ensName,
            )}</strong>'s avatar record. That record can be changed at any time; this token cannot:</span>`
          : `<span class="label">Permanent address for this token:</span>`
      }<a href="${escCanonical}">${escCanonical}</a></p>`,
    );
  }
  if (extra.via) {
    // The document did not come from the token, so say so before anything
    // else: where a picture came from is not a detail a viewer should have to
    // work out, and "assembled by us" is the least obvious provenance there is.
    rows.push(
      `<p class="row"><span class="label">Metadata: <strong>assembled by Embed.Art</strong>, not returned by the token</span></p>` +
        `<p class="row"><span class="label">${escapeHtml(
          extra.via.reason,
        )}</span></p>` +
        `<p class="row"><span class="label">Art read from <code>${escapeHtml(
          extra.via.source.address,
        )}</code> via <code>${escapeHtml(
          extra.via.source.method,
        )}</code>. <a href="?strict">Ask for the standard only</a> to see what a compliant client gets.</span></p>`,
    );
  } else if (source) {
    rows.push(
      `<p class="row"><span class="label">Metadata: <strong>${escapeHtml(
        source,
      )}</strong></span></p>`,
    );
  }
  if (externalURL) {
    rows.push(
      `<p class="row"><span class="label">Project site:</span><a href="${escapeHtml(
        externalURL,
      )}" rel="noopener nofollow ugc" target="_blank">${escapeHtml(
        externalURL,
      )}</a></p>`,
    );
  }
  const details = rows.length
    ? `<div class="details">${rows.join("")}</div>`
    : "";

  const page = `<!DOCTYPE html>
<html lang="en">
    <head>
        <title>${escTitle}</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="title" content="${escTitle}">
        ${
          description
            ? `<meta name="description" content="${escDescription}">`
            : ""
        }
        <link rel="canonical" href="${escCanonical}">
        <meta property="og:type" content="website">
        <meta property="og:url" content="${escCanonical}">
        <meta property="og:title" content="${escTitle}">
        ${
          description
            ? `<meta property="og:description" content="${escDescription}">`
            : ""
        }
        <meta property="og:image" content="${escPreview}">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:url" content="${escCanonical}">
        <meta name="twitter:title" content="${escTitle}">
        ${
          description
            ? `<meta name="twitter:description" content="${escDescription}">`
            : ""
        }
        <meta name="twitter:image" content="${escPreview}">
        <meta name="theme-color" content="#111111">
        <link rel="icon" href="/favicon.ico" sizes="32x32">
        <link rel="icon" type="image/svg+xml" href="/static/icon.svg">
        <link rel="apple-touch-icon" href="/apple-touch-icon.png">
        <style>
        /* The palette and the type are the home page's, so a token page reads
           as the same building rather than as a viewer bolted on. */
        :root {
          --plate: #111111;
          --surface: #171717;
          --line: #2A2620;
          --ink: #F5DEB3;
          --muted: #8E826A;
          --accent: #BE8F04;
          --mono: ui-monospace, Hack, "JetBrains Mono", "SF Mono", Menlo,
            Consolas, "DejaVu Sans Mono", monospace;
          /* The audio player is drawn by the browser, not by us. Without this
             it arrives as a white pill on a black page. */
          color-scheme: dark;
        }

        *, *::before, *::after {
          box-sizing: border-box;
          /* ':' and '<' shape into one cluster in monospace faces with
             contextual alternates, and the cluster takes the colour of
             whichever run it ends in. That hid the colon in erc721:<contract>. */
          font-variant-ligatures: none;
          font-feature-settings: "liga" 0, "calt" 0, "dlig" 0;
        }

        html { background: var(--plate); }

        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: var(--plate);
          color: var(--ink);
          font-family: var(--mono);
          font-size: 16px;
          line-height: 1.65;
          -webkit-text-size-adjust: 100%;
        }

        a { color: var(--ink); text-underline-offset: 3px; }
        a:hover { color: var(--accent); }
        :focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 3px;
          border-radius: 3px;
        }

        /* ---------------------------------------------------------- header */
        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 1.1rem clamp(1rem, 4vw, 2.2rem);
        }
        .topbar .brand img { display: block; height: 22px; width: auto; }
        .home {
          font-size: 0.76rem;
          color: var(--muted);
          text-decoration: none;
          white-space: nowrap;
          border: 1px solid var(--line);
          border-radius: 999px;
          padding: 0.3rem 0.9rem;
        }
        .home:hover { border-color: var(--accent); color: var(--accent); }

        main {
          flex: 1 0 auto;
          padding: 0 clamp(1rem, 4vw, 2.2rem) clamp(2rem, 6vw, 3.5rem);
        }

        /* ----------------------------------------------------------- stage */
        /* The art is the page. Everything else is a label under it, so the
           frame gets the top of the fold and as much of the viewport's short
           side as it can take without pushing the title out of sight. */
        .stage {
          display: flex;
          justify-content: center;
          align-items: center;
          --art: min(72vh, 100%);
        }

        /* An iframe has no intrinsic size to honour, so the box is SQUARE:
           token art is overwhelmingly square, and a frame of some other shape
           shows the artwork's own page background in the leftover band (Checks
           paints its body #EFEFEF, which arrived as a grey slab under the art
           on narrow screens). */
        /* Sized by width and an aspect ratio rather than by a matching
           height: a percentage height inside an auto-height flex container is
           indefinite, so a height of min(72vh, 100%) silently collapsed to
           the iframe's default 150px and the art came out as a strip. */
        #nft-iframe {
          display: none;
          width: var(--art);
          aspect-ratio: 1 / 1;
          border: 1px solid var(--line);
          border-radius: 4px;
          background: var(--plate);
        }

        /* An image knows its own shape, so it is scaled to the frame and
           letterboxed rather than matted into a square: object-fit does the
           work, which also means a portrait image clamped by max-height keeps
           its proportions instead of being stretched to the declared width.
           Scaling UP matters as much as scaling down: a 350px token image left
           at its natural size is a thumbnail on a page whose whole job is to
           show the art. */
        #nft-image {
          display: none;
          width: var(--art);
          max-width: 100%;
          max-height: 72vh;
          object-fit: contain;
          border: 1px solid var(--line);
          border-radius: 4px;
          background: var(--plate);
        }

        /* Onchain art is often a few dozen pixels square. Smoothing it on the
           way up turns deliberate pixels into mush, so keep the edges. */
        #nft-image.pixelated { image-rendering: pixelated; }

        /* Something is coming; say so rather than showing a hole. */
        .placeholder {
          width: var(--art);
          aspect-ratio: 1 / 1;
          border: 1px solid var(--line);
          border-radius: 4px;
          background: var(--surface);
          animation: breathe 2.4s ease-in-out infinite;
        }
        @keyframes breathe { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.85; } }
        @media (prefers-reduced-motion: reduce) {
          .placeholder { animation: none; }
        }

        #nft-audio {
          display: none;
          width: min(100%, 28rem);
          height: 2.4rem;
          margin: 1.1rem auto 0;
        }

        /* ------------------------------------------------------------ info */
        .info { max-width: 46rem; margin: 0 auto; text-align: center; }

        .collection {
          margin: clamp(1.5rem, 4vw, 2.2rem) 0 0.15rem;
          font-size: 0.72rem;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--accent);
        }

        #nft-title {
          margin: 0;
          font-size: clamp(1.2rem, 3.4vw, 1.7rem);
          font-weight: normal;
          line-height: 1.35;
        }

        /* Left-aligned inside a centred column: a description can be one line
           or forty, and only one of those two reads well centred. Newlines are
           kept because the author put them there. */
        #nft-description {
          /* fit-content so a one-line description sits centred under the
             title, while a long one wraps at a readable measure and stays
             left-aligned, which is the only way a paragraph reads well. */
          width: fit-content;
          max-width: 42rem;
          margin: 1.2rem auto 0;
          text-align: left;
          white-space: pre-wrap;
          color: var(--muted);
          font-size: 0.88rem;
        }

        .attrs {
          display: none;
          flex-wrap: wrap;
          justify-content: center;
          gap: 0.5rem;
          list-style: none;
          margin: 1.5rem 0 0;
          padding: 0;
        }
        .attr {
          border: 1px solid var(--line);
          border-radius: 6px;
          background: var(--surface);
          padding: 0.4rem 0.7rem;
          text-align: left;
        }
        .attr .k {
          display: block;
          font-size: 0.64rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          line-height: 1.5;
        }
        .attr .v { display: block; font-size: 0.82rem; line-height: 1.45; }

        .error {
          max-width: 42rem;
          margin: 1.5rem auto 0;
          color: #FF4444;
          text-align: left;
          font-size: 0.88rem;
        }
        .error h2 { font-size: 1rem; font-weight: normal; margin: 0 0 0.4rem; }
        .error p { margin: 0 0 0.6rem; }
        .error code { word-break: break-all; }

        /* A remark about how the art is being displayed, not about the token:
           quieter than a notice, and directly under the frame it concerns. */
        .art-hint {
          max-width: 42rem;
          margin: 0.8rem auto 0;
          color: var(--muted);
          font-size: 0.78rem;
          line-height: 1.5;
        }
        .art-hint code { color: var(--accent); }

        .notice {
          max-width: 42rem;
          margin: 1.5rem auto 0;
          padding: 1em 1.2em;
          border: 1px solid var(--line);
          border-left: 3px solid var(--accent);
          border-radius: 6px;
          text-align: left;
          font-size: 0.82rem;
          color: var(--muted);
          line-height: 1.7;
        }
        .notice strong { color: var(--accent); font-weight: normal; }
        .notice p { margin: 0.7em 0 0; }
        .notice code { color: var(--accent); word-break: break-all; }

        /* --------------------------------------------------------- details */
        .details {
          max-width: 46rem;
          margin: clamp(2rem, 5vw, 3rem) auto 0;
          padding-top: 1.2rem;
          border-top: 1px solid var(--line);
          font-size: 0.74rem;
          line-height: 1.8;
          color: var(--muted);
          text-align: left;
        }
        .details .row { margin: 0 0 0.5rem; }
        .details .row:last-child { margin: 0; }
        .details .label { display: block; }
        .details a { color: var(--accent); word-break: break-all; }
        .details strong { color: var(--accent); font-weight: normal; }

        /* ---------------------------------------------------------- footer */
        footer {
          margin-top: auto;
          padding: 1.3rem clamp(1rem, 4vw, 2.2rem);
          border-top: 1px solid var(--line);
          display: flex;
          gap: 1.25rem;
          flex-wrap: wrap;
          justify-content: space-between;
          font-size: 0.76rem;
          color: var(--muted);
        }
      </style>
    </head>
    <body>
      <header class="topbar">
        <a class="brand" href="/"><img src="/static/wordmark.svg" alt="Embed.Art"></a>
        <a class="home" href="/">embed your own &rarr;</a>
      </header>

      <main>
        <div class="stage">
          <div class="placeholder" id="art-placeholder" aria-hidden="true"></div>
          <iframe id="nft-iframe" title="${escTitle}"></iframe>
          <img id="nft-image" alt="${escTitle}"/>
        </div>
        <audio id="nft-audio" controls autoplay></audio>

        <div class="info">
          ${
            collection
              ? `<p class="collection">${escapeHtml(collection)}</p>`
              : ""
          }
          <h1 id="nft-title">${escTitle}</h1>
          <p id="nft-description"${description ? "" : ' style="display:none;"'}>${escDescription}</p>
          <ul id="nft-attributes" class="attrs"${
            attrs ? ' style="display:flex;"' : ""
          }>${attrs}</ul>

          <div id="nft-error" class="error" style="display:none;"></div>
          <div id="global-error" class="error" style="display:none;"></div>
          <div id="cors-notice" class="notice" style="display:none;"></div>
          <div id="standard-notice" class="notice" style="display:none;"></div>
          <p id="art-hint" class="art-hint" style="display:none;"></p>

          ${details}
        </div>
      </main>

      <footer>
        <span>Rendered by <a href="/">Embed.Art</a>. Embed Your Art Anywhere.</span>
        <span><a href="https://github.com/wighawag/embed-art">source</a> &middot; AGPL-3.0</span>
      </footer>

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
            ? `atobUTF8(${jsString(extra.tokenURIBase64Encoded)})`
            : tokenURI
              ? jsString(tokenURI)
              : `atobUTF8(location.hash.slice(1))`
        };
        const regex = /\\//gm;
        // What the SERVER learned fetching this very metadata URL. A browser
        // cannot tell a CORS rejection from a dead connection, but we made the
        // identical request and read the response headers, so this page never
        // has to guess out loud in front of the visitor.
        const CORS = ${jsString(extra.cors || "unknown")};
        const PREVIEW = ${jsString(extra.previewURL || "")};

        // Text from a contract, or from whatever URL it points at, on its way
        // into innerHTML. Everything the page writes that way goes through
        // this: a tokenURI is as untrusted as any other user input.
        const esc = (s) => String(s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

        // The frame holds a square of nothing until there is art to put in it.
        const hidePlaceholder = () => {
          const el = document.getElementById('art-placeholder');
          if (el) el.style.display = 'none';
        };

        const showNotice = (html) => {
          const el = document.getElementById('cors-notice');
          el.innerHTML = html;
          el.style.display = 'block';
          hidePlaceholder();
        };

        // What the token got wrong, and what we did about it. Shown after the
        // art rather than instead of it: the owner is not the one who wrote
        // the contract, and the breach is a fact about the document, not a
        // verdict on the picture.
        const showBreaches = () => {
          if (!breaches.length) return;
          const el = document.getElementById('standard-notice');
          if (!el) return;
          const list = breaches.map((b) => '<li>' + b + '</li>').join('');
          const url = location.pathname + (COURTESY ? '?strict' : location.pathname);
          el.innerHTML =
            "<strong>This token's metadata does not follow the ERC-721 standard.</strong>" +
            "<ul>" + list + "</ul>" +
            (COURTESY
              ? "<p>Embed.Art rendered it anyway, as a courtesy, so the token has a " +
                "card to unfurl. A compliant client is under no obligation to: " +
                "<a href=\\"" + esc(location.pathname) + "?strict\\">open this page with " +
                "<code>?strict</code></a> to see what one gets.</p>"
              : "<p>Rendered strictly, so this is what a compliant client sees. " +
                "<a href=\\"" + esc(location.pathname) + "\\">Drop <code>?strict</code></a> " +
                "for the courtesy version.</p>");
          el.style.display = 'block';
        };

        // The artwork could not be loaded in the browser, but the preview we
        // rendered server-side is perfectly good. Show that rather than
        // nothing, and be explicit about what the visitor is looking at.
        // A source small enough to be pixel art is drawn as pixel art once it
        // is blown up to the frame. An SVG reports no natural size worth
        // trusting, so it is left alone: it scales on its own terms.
        const keepPixelsSharp = (img) => {
          img.addEventListener('load', function () {
            if (img.naturalWidth && img.naturalWidth <= 256) {
              img.classList.add('pixelated');
            }
          }, { once: true });
        };

        // Applied to the frame the art sits in; the page around it stays the
        // page. When the token says nothing and part of the art turns out to
        // be invisible against the plate, the page says so rather than
        // quietly choosing a different colour on the artist's behalf.
        const applyBackdrop = (img, metadata) => {
          const declared = backgroundColorOf(metadata);
          const asked = requestedBackdrop(location.search);
          if (asked || declared) img.style.backgroundColor = asked || declared;
          img.addEventListener('load', function () {
            if (asked || declared) return;
            if (!hidesDarkStrokes(sampleArt(img))) return;
            const hint = document.getElementById('art-hint');
            if (!hint) return;
            hint.innerHTML =
              'Part of this art is drawn in near-black on a transparent background, ' +
              'and the token declares no <code>background_color</code>, so those ' +
              'strokes are invisible against this one. ' +
              '<a href="?bg=F5DEB3">Try a light backdrop</a>.';
            hint.style.display = 'block';
          }, { once: true });
        };

        const showServerPreview = () => {
          if (!PREVIEW) return;
          const img = document.getElementById('nft-image');
          img.src = PREVIEW;
          img.style.display = 'block';
          hidePlaceholder();
        };

        const cssURLEscaped = (uri) => {
          return uri.replace(regex, "\\/");
        };
        
        const showError = (error) => {
          const errorElement = document.getElementById('nft-error');
          errorElement.innerHTML = error;
          errorElement.style.display='block';
          hidePlaceholder();
        }
        const showGlobalError = (error) => {
          const errorElement = document.getElementById('global-error');
          errorElement.innerHTML = esc(error);
          errorElement.style.display='block';
          hidePlaceholder();
        }
        window.onerror = showGlobalError;

        // The trait table, rebuilt from the metadata the BROWSER fetched. The
        // server already rendered one from its own copy, which is what a
        // visitor sees when their browser is refused the metadata; when the
        // fetch does work, that copy is replaced by this one.
        const renderAttributes = (attributes) => {
          const list = document.getElementById('nft-attributes');
          if (!list) return;
          list.innerHTML = '';
          let shown = 0;
          if (Array.isArray(attributes)) {
            for (var i = 0; i < attributes.length; i++) {
              const attr = attributes[i];
              if (!attr || typeof attr !== 'object') continue;
              const value = attr.value;
              if (value === null || value === undefined || value === '') continue;
              if (typeof value === 'object') continue;
              const li = document.createElement('li');
              li.className = 'attr';
              if (attr.trait_type) {
                const k = document.createElement('span');
                k.className = 'k';
                k.textContent = String(attr.trait_type);
                li.appendChild(k);
              }
              const v = document.createElement('span');
              v.className = 'v';
              v.textContent = String(value);
              li.appendChild(v);
              list.appendChild(li);
              shown++;
            }
          }
          list.style.display = shown ? 'flex' : 'none';
        };

        // Some on-chain WAV generators (e.g. The Bleep Machine earliy demo on
        //  Goerli) write the RIFF and data chunk size fields as 0. Chrome 
        // tolerates this and plays the trailing bytes, but Firefox's stricter
        // demuxer honors the declared 0 length and produces silence. We patch 
        // those header fields here so the audio plays in every browser.
        // Returns a Blob URL when fixed, otherwise the original url untouched,
        // which is also how the caller knows a repair happened: this is a
        // courtesy like any other, so it is named on the page and ?strict
        // withdraws it. A silent player IS what a strict client gets.
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
        // Injected from functions/_utils/url.ts so there is ONE implementation
        // of "which URIs this origin serves", tested there and running here.
        // Bound to a name we choose rather than pasted as a declaration: the
        // bundler is free to rename the function it emits.
        //
        // The shim is not decoration. Wrangler bundles with esbuild's
        // keep-names on, which wraps every inner function in a __name() call
        // to preserve fn.name. Ship that source to a browser with no __name in
        // scope and the function throws the first time it is called, in
        // production only, where the test bundle (no keep-names) sees nothing.
        const __name = (fn) => fn;
        const gatewayPath = ${gatewayPath.toString()};
        const imageAttempts = ${imageAttempts.toString()};

        // Injected from functions/_utils/clientCourtesy.ts, same reasoning:
        // one implementation, tested there, running here and in the page the
        // preview is screenshotted from.
        // What goes behind art that does not bring its own background: the
        // token's own background_color if it declares one, this site's plate
        // otherwise, and whatever ?bg= asks for above both. Never a guess.
        // Injected from functions/_utils/artBackdrop.ts and shared with the
        // screenshot page, so the card and this page cannot disagree.
        const backdropStats = ${backdropStats.toString()};
        const backgroundColorOf = ${backgroundColorOf.toString()};
        const hidesDarkStrokes = ${hidesDarkStrokes.toString()};
        const sampleArt = ${sampleArt.toString()};
        const requestedBackdrop = ${requestedBackdrop.toString()};

        const courtesyEnabled = ${courtesyEnabled.toString()};
        const dataURIPayload = ${dataURIPayload.toString()};
        const markupKind = ${markupKind.toString()};
        const markupToDataURI = ${markupToDataURI.toString()};
        const encodedDataURI = ${encodedDataURI.toString()};

        // Repairs are extended to tokens whose metadata breaks the standard,
        // and withdrawn by ?strict, so anyone judging a token can see exactly
        // what a compliant client sees.
        const COURTESY = courtesyEnabled(location.search);
        const breaches = [];
        const noteBreach = (text) => {
          if (breaches.indexOf(text) === -1) breaches.push(text);
        };

        // Whatever a media field should have been. A value that IS markup gets
        // wrapped so it can load at all; anything else is left exactly as the
        // token wrote it.
        const mediaSource = (value, field) => {
          const kind = markupKind(value);
          if (kind) {
            noteBreach(
              "<code>" + esc(field) + "</code> contains " + kind.toUpperCase() +
              " markup rather than a URI pointing at it"
            );
            return COURTESY ? markupToDataURI(value, kind) : value;
          }
          // The artwork is a data: URI the browser would cut at its first '#'.
          const encoded = encodedDataURI(value);
          if (!encoded) return value;
          noteBreach(
            "the <code>data:</code> URI in <code>" + esc(field) + "</code> is " +
            "not percent-encoded, so a browser stops loading the artwork at " +
            "its first <code>#</code>"
          );
          return COURTESY ? encoded : value;
        };

        // A CID is the token's claim; the gateway in front of it is not, so a
        // hardcoded https gateway URL is treated exactly like ipfs:// and read
        // back through this origin. If OUR gateway choice cannot produce the
        // bytes, the URL the token actually wrote down is still worth trying:
        // it is where the content was last known to be.
        const original = (uri) => (gatewayPath(uri) && /^https?:/i.test(uri) ? uri : null);

        async function fetchImage(tokenURI) {
          // ipfs:// and friends are read back through THIS origin: which
          // gateway serves a CID is our business, not the token's claim, and
          // public gateways answer a browser (403 challenge, no CORS header)
          // differently from a server (200). An https:// URL that is NOT a
          // gateway URL is left alone: that one IS the project's claim about
          // where its metadata lives, and if it refuses cross-origin reads you
          // should see that.
          const localPath = gatewayPath(tokenURI);
          const fallbackURL = original(tokenURI);
          let metadataURLToFetch = localPath || tokenURI;
          let metadataResponse;
          let failure;
          try {
            metadataResponse = await fetch(metadataURLToFetch);
          } catch (err) {
            failure = err;
          }
          // Our gateway choice could not produce it, so try the URL the token
          // itself wrote down: a hardcoded gateway is not authoritative, but it
          // is where the content was last known to be.
          if (fallbackURL && metadataURLToFetch !== fallbackURL &&
              (!metadataResponse || !metadataResponse.ok)) {
            try {
              metadataURLToFetch = fallbackURL;
              metadataResponse = await fetch(fallbackURL);
              failure = undefined;
            } catch (err) {
              failure = err;
              metadataResponse = undefined;
            }
          }
          if (!metadataResponse) {
            const err = failure || new Error('the request failed');
            if (CORS === 'blocked') {
              // Not a guess: our server fetched this same URL and the response
              // carried no Access-Control-Allow-Origin header.
              showNotice(
                "<strong>The artwork above was rendered by Embed.Art, not by your browser.</strong>" +
                "<p>This token's metadata server does not send an " +
                "<code>Access-Control-Allow-Origin</code> header, so browsers refuse to " +
                "read it from another site. This page renders tokens client-side on " +
                "purpose, so it cannot show you the live artwork.</p>" +
                "<p>The preview card that unfurls on social platforms is unaffected: " +
                "we generate it server-side, where CORS does not apply.</p>" +
                "<p>Only the project can fix this, by allowing cross-origin reads on " +
                "<code>" + esc(metadataURLToFetch) + "</code>.</p>"
              );
              showServerPreview();
            } else if (localPath) {
              showError("<h2>Could not fetch token's metadata.</h2><p>" +
                "<code>" + esc(metadataURLToFetch) + "</code> is content-addressed, and " +
                "no gateway we tried could produce it, so it is most likely " +
                "unpinned rather than merely unreachable.</p>");
              showServerPreview();
            } else {
              // From JavaScript a CORS rejection and a dead network are the
              // same event, so name both rather than picking one: our server
              // reached this URL, which is what makes the first one likely.
              showError("<h2>Could not fetch token's metadata.</h2><p>" +
                esc(err.message || err) + "</p><p>Our server could reach " +
                "<code>" + esc(metadataURLToFetch) + "</code>, so either that host " +
                "refused to be read from another site (a CORS rejection, which " +
                "the browser reports exactly like a network failure), or " +
                "something between you and it dropped the request.</p>");
              showServerPreview();
            }
            return;
          }
          if (!metadataResponse.ok) {
            showError("<h2>Could not fetch token's metadata.</h2><p><code>" +
              esc(metadataURLToFetch) + "</code> answered " + metadataResponse.status + ".</p>");
            showServerPreview();
            return;
          }
          let metadata;
          try {
            metadata = await metadataResponse.json();
          } catch (err) {
            // The compliant read failed. For a data: URI that usually means
            // the payload was never percent-encoded, so the browser stopped at
            // its first '#' and handed us a truncated document. Reading the
            // URI as a STRING recovers every byte the contract returned.
            const payload = dataURIPayload(tokenURI);
            let recovered;
            if (payload) {
              try { recovered = JSON.parse(payload); } catch (again) { /* genuinely not JSON */ }
            }
            if (!recovered) {
              showError("<h2>The token's metadata is not valid JSON.</h2><p>" +
                esc(err.message || err) + "</p>");
              showServerPreview();
              return;
            }
            noteBreach(
              "the <code>data:</code> URI is not percent-encoded, so a browser " +
              "stops reading it at the first <code>#</code> and sees " +
              "a fraction of the document"
            );
            if (!COURTESY) {
              showError("<h2>The token's metadata is not valid JSON.</h2><p>" +
                esc(err.message || err) + "</p>");
              showBreaches();
              showServerPreview();
              return;
            }
            metadata = recovered;
          }

          if (metadata.name) {
            const title = document.getElementById('nft-title');
            title.textContent = metadata.name; // TODO contract URI symbol + tokenID as fallback
            title.style.display='block';
            document.title = metadata.name;
          }
          if (metadata.description) {
            const description = document.getElementById('nft-description');
            description.textContent = metadata.description;
            description.style.display='block';
          }
          renderAttributes(metadata.attributes);
          
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
            iframeURL = mediaSource(iframeURL, 'animation_url');
            const localIframe = gatewayPath(iframeURL);
            // Art we serve from our own origin is framed WITHOUT
            // allow-same-origin, so it runs but cannot act as embed.art. Art
            // on someone else's origin is left exactly as it was: it is
            // already separated from us by that origin.
            if (localIframe) iframe.sandbox = 'allow-scripts';
            iframe.src = localIframe || iframeURL;
            iframe.style.display='block';
            hidePlaceholder();
          } else if (metadata.image) {
            const img = document.getElementById('nft-image');
            const imageSource = mediaSource(metadata.image, 'image');
            const attempts = imageAttempts(imageSource);
            let attempt = 0;
            img.onerror = function () {
              attempt++;
              if (attempt < attempts.length) { img.src = attempts[attempt]; return; }
              img.onerror = null;
              if (!PREVIEW) return;
              // Nothing left for the browser to try. This is not a missing
              // artwork: this page exists at all because our server fetched
              // that image to render the preview, so the failure is between
              // this browser and that host. Show the preview and say which.
              showNotice(
                "<strong>The artwork above was rendered by Embed.Art, not by " +
                "your browser.</strong>" +
                "<p>Your browser could not load <code>" +
                esc(attempts[attempts.length - 1]) + "</code>. The preview " +
                "shown was made from that same image on our side, so the art " +
                "is where the token says it is: something between this browser " +
                "and that host dropped the request. A DNS filter, a blocklist " +
                "or an extension will do it.</p>" +
                "<p>The card that unfurls on social platforms is unaffected, " +
                "for the same reason.</p>"
              );
              showServerPreview();
            };
            keepPixelsSharp(img);
            applyBackdrop(img, metadata);
            img.src = attempts[0];
            img.style.display='block';
            hidePlaceholder();
          } else {
            hidePlaceholder();
          }

          // Before showBreaches(), because repairing the audio may add one.
          if (audioURL) {
            const audio = document.getElementById('nft-audio');
            const audioSource = gatewayPath(audioURL) || audioURL;
            const playable = fixMalformedWav(audioSource);
            if (playable !== audioSource) {
              noteBreach(
                "the WAV in <code>animation_url</code> declares a chunk size " +
                "of <code>0</code>, which a strict demuxer honours by playing " +
                "silence"
              );
              // Reporting the breach means running the repair, even when we
              // are about to refuse it. Hand the bytes back rather than
              // leaving an object URL alive for a page that will not play it.
              if (!COURTESY) URL.revokeObjectURL(playable);
            }
            audio.src = COURTESY ? playable : audioSource;
            audio.style.display='block';
          }

          showBreaches();
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
