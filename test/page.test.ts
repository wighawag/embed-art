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
  eq("canonical is visible on the page", ensHtml.includes(`<a href="${CANON}">${CANON}</a>`), true);
  eq("page names the ENS it came from", ensHtml.includes("sassal.eth</strong>"), true);
  eq("ENS-derived page is not cacheable", viaEns.headers.get("cache-control"), "no-store");

  const direct = await build({ canonical: CANON });
  const directHtml = await direct.text();
  eq("direct token page still gets a canonical", directHtml.includes(`<link rel="canonical" href="${CANON}">`), true);
  eq("direct page does not mention ENS", directHtml.includes("ENS avatar"), false);
  eq("direct token page is cacheable", direct.headers.get("cache-control"), null);

  report();
}

main();
