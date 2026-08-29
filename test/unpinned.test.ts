/**
 * The /unpinned page is generated from the survey dataset, precisely so its
 * numbers cannot drift from the measurement they describe. That only holds if
 * the generator really does read every number out of the data, so render a
 * fixture and check the page says what the fixture says.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, report, section } from "./assert";

const root = process.cwd();
const out = join(mkdtempSync(join(tmpdir(), "embed-art-unpinned-")), "page.html");

execFileSync(
  "node",
  [
    join(root, "tools/render-unpinned.mjs"),
    "--in",
    "test/fixtures/survey.json",
    "--out",
    out,
  ],
  { cwd: root, stdio: "pipe" }
);

const html = readFileSync(out, "utf8");
// Prose in the template wraps across lines, so phrase checks run against a
// whitespace-flattened copy rather than the source.
const text = html.replace(/\s+/g, " ");
const fixture = JSON.parse(
  readFileSync(join(root, "test/fixtures/survey.json"), "utf8")
);

section("the /unpinned page is the dataset, rendered");

eq("sampled contract count", html.includes(">40<"), true);
eq("content-addressed count", html.includes(">10<"), true);
eq("unreachable count", html.includes(">2<"), true);
// 2 of 10 is 20%, and the page must compute that rather than be told it.
eq("the percentage is derived", html.includes(">20%<"), true);
// The totals a reader would otherwise have to add up by hand.
eq("minted tokens behind those collections", html.includes("10,500"), true);
eq("survey date", html.includes("2026-01-02"), true);
eq("rpc calls", html.includes("1,234"), true);

section("every collection is listed and linked");

for (const c of fixture.unreachable) {
  eq(
    `${c.symbol}: links to its token page here`,
    html.includes(`/eip155:1/erc721:${c.address}/${c.sampledTokenId}`),
    true
  );
  eq(`${c.symbol}: supply shown`, html.includes(c.totalSupply.toLocaleString("en-US")), true);
}
// Inside the table only: names also appear in the prose above it.
const tbody = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
eq("sorted by supply, largest first", tbody.indexOf("Test Birds") < tbody.indexOf("Escaped"), true);
for (const c of fixture.unreachable) {
  // The row's evidence is the address the contract gives, so the link is that
  // address and not a rewrite of it through this site.
  eq(
    `${c.symbol}: its URI is a link to the address itself`,
    html.includes(`<a href="${c.tokenURI}" title="${c.tokenURI}"`),
    true
  );
}
eq(
  "gateway answers are shown, not just the verdict",
  html.includes("ipfs.io: 504"),
  true
);
// 410 is a refusal to relay, not an absence of the bytes, and conflating the
// two would accuse the wrong party.
eq("a denylisted CID is marked blocked", html.includes(">blocked<"), true);
eq(
  "and the difference is explained",
  text.includes("a refusal rather than a shrug"),
  true
);
eq(
  "content with no provider is not called blocked",
  (html.match(/>blocked</g) || []).length,
  1
);
// A name is attacker-controlled data from a contract, so it is escaped.
eq("names are escaped", html.includes("Small &amp; &lt;Escaped&gt;"), true);
eq("raw name is not injected", html.includes("Small & <Escaped>"), false);

section("the claim is stated honestly");

eq(
  "unreachable is not presented as destroyed",
  text.includes("not proof it is destroyed"),
  true
);
eq("re-pinning is explained as the fix", text.includes("Pin the CID again"), true);
eq("the sample's limits are stated", text.includes("Known limits of this sample"), true);
eq("the dataset is downloadable", html.includes("/data/unpinned-survey.json"), true);
eq("the tool is linked", html.includes("tools/survey-unpinned.mjs"), true);

report();
