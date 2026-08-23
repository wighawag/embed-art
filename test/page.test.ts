/**
 * The token page is one large template literal containing a client-side
 * script. A stray backtick or `${` while editing it breaks every token page at
 * once and nothing else would catch it, so render the page and syntax-check
 * the script it emits.
 */
import { pageWithRawData } from "../functions/_handlers/pageWithRawData";
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
  eq("the image is mapped too", script.includes("gatewayPath(metadata.image)"), true);
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
  eq(
    "the injected copy actually runs",
    new Function(injected + "; return gatewayPath;")()("ipfs://QmAbc/1"),
    "/ipfs/QmAbc/1"
  );

  const injectedOriginal = new Function(injected + "; return original;")();
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

  report();
}

main();
