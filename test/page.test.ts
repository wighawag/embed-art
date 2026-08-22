/**
 * The token page is one large template literal containing a client-side
 * script. A stray backtick or `${` while editing it breaks every token page at
 * once and nothing else would catch it, so render the page and syntax-check
 * the script it emits.
 */
import { pageWithRawData } from "../functions/_handlers/pageWithRawData";
import { CorsStatus } from "../functions/_utils/metadata";
import { eq, report, section } from "./assert";

async function render(cors: CorsStatus, tokenURI = "https://example.com/meta/1") {
  const res = await pageWithRawData(
    { contract: "0xabc", id: "1" },
    tokenURI,
    { name: "Test", symbol: "TST" },
    {
      url: "https://embed.art/x",
      previewURL: "https://embed.art/images/a.jpg",
      cors,
    },
    { name: "Tok", description: "d" }
  );
  return res.text();
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

  report();
}

main();
