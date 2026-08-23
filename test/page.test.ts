/**
 * The token page is one large template literal containing a client-side
 * script. A stray backtick or `${` while editing it breaks every token page at
 * once and nothing else would catch it, so render the page and syntax-check
 * the script it emits.
 */
import { errorPage } from "../functions/_handlers/errorPage";
import { pageWithRawData } from "../functions/_handlers/pageWithRawData";
import { screenshotHTML } from "../functions/_handlers/screenshotWithAllData";
import { CorsStatus } from "../functions/_utils/metadata";
import { eq, report, section } from "./assert";

const CANON = "https://embed.art/eip155:1/erc1155:0xabc/1";

function build(extra: Record<string, unknown> = {}) {
  return pageWithRawData(
    { contract: "0xabc", id: "1" },
    "https://example.com/meta/1",
    { name: "Test", symbol: "TST" },
    {
      url: "https://embed.art/sassal.eth",
      previewURL: "https://embed.art/images/a.jpg",
      ...extra,
    } as any,
    { name: "Tok", description: "d" }
  );
}

async function render(cors: CorsStatus) {
  return (await build({ cors })).text();
}

function lastScript(html: string): string {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return scripts[scripts.length - 1][1];
}

async function main() {
  section("token page template");

  for (const cors of ["blocked", "allowed", "unknown", "not-applicable"] as CorsStatus[]) {
    const html = await render(cors);
    const injected = html.match(/const CORS = ("[^"]*");/);
    eq(`cors=${cors} is injected`, injected && injected[1], `"${cors}"`);

    let parses = true;
    try {
      // eslint-disable-next-line no-new-func
      new Function(lastScript(html));
    } catch {
      parses = false;
    }
    eq(`cors=${cors} client script parses`, parses, true);
  }

  section("content-addressed URIs are read back through this origin");

  // The BAYC bug: ipfs.io answers our worker 200 with `access-control-allow-
  // origin: *` and answers a browser 403 with no CORS header at all, so the
  // page must never send the visitor to a public gateway.
  const anyPage = await render("not-applicable");
  const script = lastScript(anyPage);
  eq("gatewayPath is injected", script.includes("const gatewayPath = "), true);
  eq(
    "the metadata URL goes through gatewayPath",
    script.includes("const localPath = gatewayPath(tokenURI)"),
    true
  );
  eq(
    "no public gateway is hardcoded in the page any more",
    script.includes("https://ipfs.io/"),
    false
  );
  eq("the image is mapped too", script.includes("gatewayPath(imageSource)"), true);
  eq(
    "html art we host is framed without our origin",
    script.includes("iframe.sandbox = 'allow-scripts'"),
    true
  );
  // A token that hardcodes a gateway named a CID, not a courier, so it is
  // fetched through ours; but if ours cannot produce the bytes, the URL the
  // token wrote down is still where they were last known to be.
  eq(
    "the token's own gateway is kept as a fallback",
    script.includes("const fallbackURL = original(tokenURI)"),
    true
  );
  eq("the image falls back too", script.includes("img.onerror"), true);
  // A non-2xx is not an exception, so it used to fall through to an unhandled
  // JSON parse and a blank page.
  eq("a non-2xx answer is reported", script.includes("!metadataResponse.ok"), true);
  eq(
    "the meaningless err.response test is gone",
    script.includes("err.response === undefined"),
    false
  );
  // The injected copy has to work on its own: it is evaluated in a page that
  // has none of this module's scope.
  // Sliced from the shim, not from the function: the page evaluates both, and
  // evaluating only the function would quietly supply a scope the browser does
  // not have. Under keep-names (how wrangler bundles, and how the test runner
  // bundles for that reason) the injected source calls __name.
  const start = script.indexOf("const __name = ");
  const end = script.indexOf("async function fetchImage");
  const injected = script.slice(start, end);
  eq("the bundler's keep-names helper is shimmed", start !== -1, true);
  // The injected block reads location.search to decide whether the courtesy
  // layer is on, so give it the one global it expects and nothing else.
  const inScope = (expression: string, search = "") =>
    new Function("location", "esc", injected + "; return " + expression + ";")(
      { search, pathname: "/t" },
      (s: string) => s
    );

  eq(
    "the injected copy actually runs",
    inScope("gatewayPath")("ipfs://QmAbc/1"),
    "/ipfs/QmAbc/1"
  );

  section("courtesies for metadata that breaks the standard");

  // A data: URI that was never percent-encoded: a browser stops at the '#'.
  const brokenURI = 'data:text/plain,{"image":"<svg fill=\'#eee\'></svg>"}';
  eq(
    "a malformed data: URI is read from the string, not fetched",
    inScope("dataURIPayload")(brokenURI),
    '{"image":"<svg fill=\'#eee\'></svg>"}'
  );
  eq("markup in an image field is recognised", inScope("markupKind")("<svg></svg>"), "svg");
  eq("a URI is not markup", inScope("markupKind")("ipfs://QmAbc"), null);
  eq(
    "markup is wrapped so it can load",
    inScope("mediaSource")("<svg/>", "image"),
    "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E"
  );
  // ?strict withdraws every repair, which is the point of having one switch.
  eq(
    "strict mode leaves the breach exactly as written",
    inScope("mediaSource", "?strict")("<svg/>", "image"),
    "<svg/>"
  );
  eq("courtesy is the default", inScope("COURTESY"), true);
  eq("?strict turns it off", inScope("COURTESY", "?strict"), false);
  eq("?strict=1 too", inScope("COURTESY", "?strict=1"), false);
  eq(
    "a repair is recorded rather than performed silently",
    inScope("(() => { mediaSource('<svg/>', 'image'); return breaches.length; })()"),
    1
  );
  eq("the page explains it and offers the strict view", script.includes("?strict"), true);
  eq(
    "and names the standard it is measured against",
    script.includes("does not follow the ERC-721 standard"),
    true
  );

  const injectedOriginal = inScope("original");
  eq(
    "a hardcoded gateway is its own last-resort fallback",
    injectedOriginal("https://ipfs.io/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq"),
    "https://ipfs.io/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq"
  );
  eq("an ipfs:// URI has no fallback to offer", injectedOriginal("ipfs://QmAbc"), null);
  eq("a plain URL is not fetched through us at all", injectedOriginal("https://api.example/1"), null);

  const blocked = await render("blocked");
  eq(
    "blocked page names the offending header",
    blocked.includes("Access-Control-Allow-Origin"),
    true
  );
  eq(
    "blocked page still offers the server preview",
    blocked.includes("showServerPreview"),
    true
  );
  eq(
    "page no longer hedges about the cause",
    blocked.includes("It is not possible for us to know"),
    false
  );
  // An https metadata host that refuses cross-origin reads is the project's
  // mistake, and stays a visible failure rather than being proxied away.
  eq(
    "a CORS rejection is still named as a possible cause elsewhere",
    lastScript(blocked).includes("a CORS rejection, which "),
    true
  );
  eq("preview URL is available to the script", blocked.includes("const PREVIEW ="), true);

  section("presentation");

  const shown = await build({ canonical: CANON });
  const shownHtml = await shown.text();

  // A visitor who lands here from a shared link has no way back to the site
  // otherwise: the token page IS the front door for most people who see it.
  eq(
    "the wordmark links home",
    shownHtml.includes('<a class="brand" href="/"><img src="/static/wordmark.svg"'),
    true
  );
  eq("and so does the footer", shownHtml.includes('Rendered by <a href="/">Embed.Art</a>'), true);

  // Audio art is a piece with an end. Looping it turns a composition into
  // hold music, and there is no way to stop it short of leaving the page.
  const audioTag = shownHtml.match(/<audio[^>]*>/);
  eq("the audio element exists", !!audioTag, true);
  eq("audio does not loop", audioTag && audioTag[0].includes("loop"), false);

  // Rendered server-side as well as client-side, so the traits survive a
  // metadata host that refuses the browser but answered us.
  const withAttrs = await (
    await pageWithRawData(
      { contract: "0xabc", id: "1" },
      "https://example.com/meta/1",
      { name: "Loot", symbol: "LOOT" },
      { url: "https://embed.art/x", previewURL: "p.jpg" } as any,
      {
        name: "Bag #1",
        attributes: [
          { trait_type: "Head", value: "Divine Hood" },
          { trait_type: "Empty", value: null },
          { trait_type: "Nested", value: { a: 1 } as any },
          { trait_type: "Count", value: 0 },
        ],
      }
    )
  ).text();
  eq(
    "traits are rendered server-side",
    withAttrs.includes('<li class="attr"><span class="k">Head</span><span class="v">Divine Hood</span></li>'),
    true
  );
  eq("a null trait is dropped", withAttrs.includes(">Empty<"), false);
  eq("an object trait is dropped", withAttrs.includes(">Nested<"), false);
  eq("a zero trait is kept", withAttrs.includes('<span class="v">0</span>'), true);
  eq("the collection labels the token", withAttrs.includes("Loot (LOOT)"), true);

  section("nothing a contract writes becomes markup");

  // Every string below is chosen by whoever deployed the contract, or by
  // whoever answers its tokenURI. None of it may end up as code.
  const hostileURI =
    "https://evil.example/`+alert(1)+`${alert(2)}</script><script>alert(3)</script>";
  const hostile = await (
    await pageWithRawData(
      { contract: "0xabc", id: "1" },
      hostileURI,
      { name: '</title><script>alert(4)</script>', symbol: "X" },
      { url: "https://embed.art/x", previewURL: 'p.jpg" onload="alert(5)' } as any,
      {
        name: '<img src=x onerror=alert(6)>',
        description: '"><script>alert(7)</script>',
        attributes: [{ trait_type: "<b>k</b>", value: "<b>v</b>" }],
      }
    )
  ).text();

  eq("no raw script tag from the token URI", hostile.includes("<script>alert(3)"), false);
  eq("no raw script tag from the metadata", hostile.includes("<script>alert(7)"), false);
  eq("the token's name cannot open a tag", hostile.includes("<img src=x onerror"), false);
  eq("a trait cannot open a tag", hostile.includes("<b>k</b>"), false);
  eq("the escaped name is what is shown", hostile.includes("&lt;img src=x onerror=alert(6)&gt;"), true);
  // The URI is injected into a JS string. A backtick or a ${ in it used to end
  // the literal, which is a contract writing our page's code.
  let hostileParses = true;
  try {
    new Function(lastScript(hostile));
  } catch {
    hostileParses = false;
  }
  eq("the page's script still parses", hostileParses, true);
  const uriLiteral = lastScript(hostile).match(/const tokenURI = (.*);/)[1];
  eq(
    "and it reads the URI back unchanged",
    new Function("return " + uriLiteral)(),
    hostileURI
  );

  section("canonical URL and ENS caching");

  const viaEns = await build({
    canonical: CANON,
    ensName: "sassal.eth",
    noStore: true,
  });
  const ensHtml = await viaEns.text();

  eq("rel=canonical points at the token", ensHtml.includes(`<link rel="canonical" href="${CANON}">`), true);
  eq("og:url is the canonical, not the ENS alias", ensHtml.includes(`<meta property="og:url" content="${CANON}">`), true);
  eq("twitter:url is the canonical too", ensHtml.includes(`<meta name="twitter:url" content="${CANON}">`), true);
  eq("the ENS alias is not used as og:url", ensHtml.includes('og:url" content="https://embed.art/sassal.eth"'), false);
  eq("canonical block is shown when arriving via ENS", ensHtml.includes(`<a href="${CANON}">${CANON}</a>`), true);
  eq("page names the ENS it came from", ensHtml.includes("sassal.eth</strong>"), true);
  eq("ENS-derived page is not cacheable", viaEns.headers.get("cache-control"), "no-store");

  const onCanonical = await build({ canonical: CANON, showCanonical: false });
  const onCanonicalHtml = await onCanonical.text();
  eq("no canonical block when already on the canonical URL",
     onCanonicalHtml.includes('class="canonical"'), false);
  eq("rel=canonical is still emitted there",
     onCanonicalHtml.includes(`<link rel="canonical" href="${CANON}">`), true);

  const direct = await build({ canonical: CANON });
  const directHtml = await direct.text();
  eq("direct token page still gets a canonical", directHtml.includes(`<link rel="canonical" href="${CANON}">`), true);
  eq("direct page does not mention ENS", directHtml.includes("ENS avatar"), false);
  eq("direct token page is cacheable", direct.headers.get("cache-control"), null);

  section("a document we assembled says so");

  // The rule for adapters: whatever they produce is disclosed. A viewer should
  // never have to work out that the picture did not come from the token.
  const assembled = await build({
    via: {
      collection: "CryptoPunks",
      note: "assembled from the collection's onchain renderer",
      reason: "CryptoPunks predates ERC-721: the contract has no tokenURI.",
      source: {
        address: "0x16f5a35647d6f03d5d3da7b35409d65ba03af3b2",
        method: "punkImageSvg(uint16)",
      },
    },
  });
  const assembledHtml = await assembled.text();
  eq(
    "the page says who assembled the document",
    assembledHtml.includes("assembled by Embed.Art"),
    true
  );
  eq(
    "names the contract the art was read from",
    assembledHtml.includes("0x16f5a35647d6f03d5d3da7b35409d65ba03af3b2"),
    true
  );
  eq("and the function", assembledHtml.includes("punkImageSvg(uint16)"), true);
  eq("and why there was no tokenURI", assembledHtml.includes("predates ERC-721"), true);
  eq("and offers the strict view", assembledHtml.includes('href="?strict"'), true);

  const ordinary = await build();
  eq(
    "an ordinary token claims nothing of the sort",
    (await ordinary.text()).includes("assembled by Embed.Art"),
    false
  );

  section("the screenshot page (which IS the preview)");

  // Everything the token wrote arrives inside our script tag, so the script
  // has to survive whatever it contains. This URI carries the three hazards:
  // an escape sequence JSON needs kept, a backtick, and a closing script tag.
  const nastyURI =
    'data:text/plain,{"description":"line one\\nline two","image":"<svg/>`</script>"}';
  const shot = screenshotHTML(nastyURI);
  const shotScript = lastScript(shot);

  let shotParses = true;
  try {
    // eslint-disable-next-line no-new-func
    new Function(shotScript);
  } catch {
    shotParses = false;
  }
  eq("the screenshot script survives a hostile tokenURI", shotParses, true);
  eq(
    "the URI is a JSON string literal, not a template literal",
    shotScript.includes('const tokenURI = "data:text/plain,'),
    true
  );
  eq(
    "an escape sequence survives the trip",
    shotScript.includes("line one\\\\nline two"),
    true
  );
  eq("a closing script tag cannot end our script", shot.includes("<\/script>\"}"), false);

  // The shutter must not open before the art is drawn: #ready is what the
  // renderer waits for, and a blank card is what an early one produces.
  eq("an image is awaited", shotScript.includes("probe.addEventListener('load', signalReady"), true);
  eq("an animation is awaited", shotScript.includes("iframe.addEventListener('load'"), true);
  eq("with a cap so a card is always produced", shotScript.includes("setTimeout(signalReady, 12000)"), true);
  eq(
    "and the courtesy layer runs here too",
    shotScript.includes("const markupToDataURI ="),
    true
  );

  section("error pages");

  const generic = await errorPage("metadata", new Error("boom"), {
    origin: "https://embed.art",
    tokenURI: "https://api.example/1",
  }).text();
  eq(
    "a metadata host that died gets the generic story",
    generic.includes("The metadata server may be down"),
    true
  );

  // For a CID there is no server to be down, and saying so is the difference
  // between blaming a host and describing what happened.
  const unpinned = await errorPage("metadata", new Error("no source answered"), {
    origin: "https://embed.art",
    tokenURI: "ipfs://bafybeia3lejponr2skhobnhbcoauf4ldvwylpwcqmwgocqx2ustsqx6bby/1",
    message:
      "This token's metadata is content-addressed, and no gateway could find " +
      "anyone still providing it. A hash names which bytes the token means; " +
      "it does not oblige anyone to keep them.",
  }).text();
  eq(
    "unpinned content is described, not blamed on a server",
    unpinned.includes("no gateway could find anyone still providing it"),
    true
  );
  eq(
    "and the generic line is replaced, not appended",
    unpinned.includes("The metadata server may be down"),
    false
  );
  eq(
    "the override reaches the unfurl description too",
    unpinned.includes('property="og:description" content="This token&#039;s metadata is content-addressed'),
    true
  );

  report();
}

main();
