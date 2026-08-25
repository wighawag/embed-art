/**
 * Offline checks for the pure parsing/encoding functions. No network, no
 * bindings. These are the places where a wrong character silently produces a
 * page that says "unreadable" about a perfectly good token.
 */
import {
  ADAPTERS,
  findAdapter,
  punkAttributes,
  reencodeSvgDataURI,
} from "../functions/_utils/adapters";
import {
  backdropStats,
  backgroundColorOf,
  hidesDarkStrokes,
  requestedBackdrop,
} from "../functions/_utils/artBackdrop";
import { outboundHeaders, upstreamsFor } from "../functions/_handlers/gateway";
import { fetchFirstAvailable } from "../functions/_utils/request";
import {
  ethCall,
  getEndpoints,
  isGasCapError,
  RpcError,
} from "../functions/_utils/rpc";
import { audioSource } from "../functions/_handlers/media";
import {
  candidateURIs,
  gatewayPath,
  gatewayURI,
  imageAttempts,
} from "../functions/_utils/url";
import { isEnsName, normalizeEnsName, parseAvatarRecord } from "../functions/_utils/ens";
import {
  dataURIDocument,
  erc1155IdHex,
  isRenderable,
  parseMetadata,
} from "../functions/_utils/metadata";
import { encodedDataURI } from "../functions/_utils/clientCourtesy";
import { parseTokenSegment } from "../functions/_utils/url";
import { eq, report, section, throws } from "./assert";

section("parseAvatarRecord (ENSIP-12 / CAIP-22 / CAIP-29)");

// The example given verbatim in ENSIP-12.
const BAYC = "eip155:1/erc721:0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/0";
eq("ENSIP-12 example", parseAvatarRecord(BAYC), {
  kind: "nft",
  chainId: "1",
  standard: "erc721",
  contract: "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d",
  tokenID: "0",
  record: BAYC,
});

eq(
  "erc1155",
  parseAvatarRecord("eip155:137/erc1155:0xAbC0000000000000000000000000000000000001/42").kind,
  "nft"
);
eq("non-mainnet chain is kept", (parseAvatarRecord(
  "eip155:137/erc1155:0xAbC0000000000000000000000000000000000001/42"
) as any).chainId, "137");

// Regression. sassal.eth really is registered with an uppercase namespace.
// CAIP-19 says lowercase; the chain says otherwise. Rejecting it would show a
// real NFT avatar as unreadable.
const SASSAL =
  "eip155:1/ERC1155:0x495f947276749ce646f68ac8c248420045cb7b5e/109791375735522898048150917964456965919994596086232976516654423066184641413121";
eq("uppercase ERC1155 (sassal.eth)", parseAvatarRecord(SASSAL).kind, "nft");
eq("uppercase namespace normalised", (parseAvatarRecord(SASSAL) as any).standard, "erc1155");
eq("78-digit token id kept as string", (parseAvatarRecord(SASSAL) as any).tokenID.length, 78);
eq(
  "uppercase EIP155 prefix",
  parseAvatarRecord("EIP155:1/ERC721:0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/0").kind,
  "nft"
);

eq("empty", parseAvatarRecord("").kind, "none");
eq("null", parseAvatarRecord(null).kind, "none");
eq("whitespace only", parseAvatarRecord("   ").kind, "none");
eq("surrounding whitespace trimmed", parseAvatarRecord(`  ${BAYC}  `).kind, "nft");

eq("https image", parseAvatarRecord("https://example.com/a.png").kind, "image");
eq("ipfs image", parseAvatarRecord("ipfs://QmAbc").kind, "image");
eq("data image", parseAvatarRecord("data:image/svg+xml;base64,PHN2Zz4=").kind, "image");
eq("arweave image", parseAvatarRecord("ar://abc").kind, "image");

eq("short address is not an nft ref", parseAvatarRecord("eip155:1/erc721:0xdead/0").kind, "unknown");
eq(
  "erc20 is not an nft ref",
  parseAvatarRecord("eip155:1/erc20:0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/0").kind,
  "unknown"
);
eq(
  "non-numeric token id",
  parseAvatarRecord("eip155:1/erc721:0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d/abc").kind,
  "unknown"
);
eq("garbage", parseAvatarRecord("hello world").kind, "unknown");

section("parseTokenSegment (URL path)");
eq("erc721", parseTokenSegment("erc721:0xAbC"), { standard: "erc721", contract: "0xAbC" });
eq("erc1155", parseTokenSegment("erc1155:0xAbC"), { standard: "erc1155", contract: "0xAbC" });
eq("legacy eip721", parseTokenSegment("eip721:0xAbC"), { standard: "erc721", contract: "0xAbC" });
eq("legacy eip1155", parseTokenSegment("eip1155:0xAbC"), { standard: "erc1155", contract: "0xAbC" });
eq("uppercase kind", parseTokenSegment("ERC721:0xAbC"), { standard: "erc721", contract: "0xAbC" });
eq("contract case preserved", parseTokenSegment("erc721:0xAbCdEf")!.contract, "0xAbCdEf");
eq("erc20 rejected", parseTokenSegment("erc20:0xAbC"), null);
eq("no colon", parseTokenSegment("erc721"), null);
eq("empty contract", parseTokenSegment("erc721:"), null);
eq("undefined", parseTokenSegment(undefined), null);

section("erc1155IdHex (EIP-1155 {id} substitution)");
eq("id 0", erc1155IdHex("0"), "0".repeat(64));
eq("id 1", erc1155IdHex("1"), "0".repeat(63) + "1");
eq("always 64 chars", erc1155IdHex("123456789012345678901234567890").length, 64);
eq(
  "known value",
  erc1155IdHex("314592"),
  "000000000000000000000000000000000000000000000000000000000004cce0"
);
eq("lowercase hex only", /^[0-9a-f]{64}$/.test(erc1155IdHex("48879")), true);
eq(
  "sassal.eth token id",
  erc1155IdHex("109791375735522898048150917964456965919994596086232976516654423066184641413121"),
  "f2bbb76db4d383e3024fbd17a8ba85c883c4f124000000000000010000000001"
);

section("isEnsName (routing)");
eq("plain name", isEnsName("/vitalik.eth"), "vitalik.eth");
eq("uppercase lowered", isEnsName("/VITALIK.ETH"), "vitalik.eth");
eq("subdomain", isEnsName("/sub.vitalik.eth"), "sub.vitalik.eth");
eq("favicon is not a name", isEnsName("/favicon.ico"), null);
eq("manifest is not a name", isEnsName("/manifest.webmanifest"), null);
eq("token path is not a name", isEnsName("/eip155:1/erc721:0xabc/1"), null);
eq("root", isEnsName("/"), null);
eq("nested path", isEnsName("/a/b.eth"), null);
eq("bare .eth with query is not matched", isEnsName("/a.eth?x=1"), null);

section("normalizeEnsName (the resolve API and the builder's contract field)");
eq("plain name", normalizeEnsName("bleeps.eth"), "bleeps.eth");
eq("uppercase lowered", normalizeEnsName("Bleeps.ETH"), "bleeps.eth");
eq("surrounding whitespace", normalizeEnsName("  bleeps.eth "), "bleeps.eth");
eq("subname", normalizeEnsName("sub.bleeps.eth"), "sub.bleeps.eth");
eq("an address is not a name", normalizeEnsName("0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d"), null);
eq("other TLDs are not resolved here", normalizeEnsName("bleeps.xyz"), null);
eq("a path is not a name", normalizeEnsName("a/b.eth"), null);
eq("a query is not a name", normalizeEnsName("a.eth?x=1"), null);
eq("empty", normalizeEnsName(""), null);
eq("null", normalizeEnsName(null), null);

section("gatewayURI (what the SERVER fetches)");
const SOME_CID = "QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq";
const SOME_TX = "OVAmf1xgB6atP0uZg1U0fMd0Lw6DlsVqdvab-WTXZ1Q";
eq("ipfs", gatewayURI(`ipfs://${SOME_CID}`), `https://ipfs.io/ipfs/${SOME_CID}`);
eq("ipfs with redundant prefix", gatewayURI(`ipfs://ipfs/${SOME_CID}`), `https://ipfs.io/ipfs/${SOME_CID}`);
eq("ipns", gatewayURI("ipns://example.eth"), "https://ipfs.io/ipns/example.eth");
eq("arweave", gatewayURI(`ar://${SOME_TX}`), `https://arweave.net/${SOME_TX}`);
// The server substitutes our gateway for theirs too, so both sides of the
// page agree on where the bytes come from.
eq(
  "somebody else's gateway becomes ours",
  gatewayURI(`https://gateway.pinata.cloud/ipfs/${SOME_CID}/0`),
  `https://ipfs.io/ipfs/${SOME_CID}/0`
);
eq("https untouched", gatewayURI("https://a/b.png"), "https://a/b.png");
eq("data untouched", gatewayURI("data:image/png;base64,AA"), "data:image/png;base64,AA");

section("candidateURIs (ours first, theirs last)");
eq(
  "an ipfs:// URI has only our gateways",
  candidateURIs(`ipfs://${SOME_CID}`),
  [
    `https://ipfs.io/ipfs/${SOME_CID}`,
    `https://dweb.link/ipfs/${SOME_CID}`,
    `https://w3s.link/ipfs/${SOME_CID}`,
  ]
);
// The courier the token named is not authoritative, but it is where the
// content was last known to be, so it is tried last rather than discarded.
eq(
  "a hardcoded gateway is kept as a last resort",
  candidateURIs(`https://gateway.pinata.cloud/ipfs/${SOME_CID}`).slice(-1)[0],
  `https://gateway.pinata.cloud/ipfs/${SOME_CID}`
);
eq(
  "but it is not tried first",
  candidateURIs(`https://gateway.pinata.cloud/ipfs/${SOME_CID}`)[0],
  `https://ipfs.io/ipfs/${SOME_CID}`
);
eq(
  "no duplicate when they named the gateway we use",
  candidateURIs(`https://ipfs.io/ipfs/${SOME_CID}`).length,
  3
);
eq("a plain URL is its own only candidate", candidateURIs("https://api.example/1"), [
  "https://api.example/1",
]);

section("gatewayPath (what the BROWSER is given)");
// A real CID and a real Arweave txid, for the shape checks below.
const CID = "QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq";
const CIDv1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const TXID = "OVAmf1xgB6atP0uZg1U0fMd0Lw6DlsVqdvab-WTXZ1Q";

// A CID is content: where it is fetched from is nobody's claim, so it comes
// back through this origin, where no gateway can challenge the browser.
eq("ipfs", gatewayPath(`ipfs://${CID}/0`), `/ipfs/${CID}/0`);
eq("ipfs with redundant prefix", gatewayPath(`ipfs://ipfs/${CID}`), `/ipfs/${CID}`);
eq("ipns", gatewayPath("ipns://example.eth"), "/ipns/example.eth");
eq("arweave", gatewayPath(`ar://${TXID}`), `/ar/${TXID}`);
eq("bare scheme", gatewayPath("ipfs://"), null);

// A token that writes `https://ipfs.io/ipfs/<cid>` has not chosen ipfs.io in
// any meaningful sense: it named a CID and copied down a courier. Which
// courier is ours to pick, so these are the same case as ipfs://.
eq("a hardcoded gateway is still a CID", gatewayPath(`https://ipfs.io/ipfs/${CID}/0`), `/ipfs/${CID}/0`);
eq("pinata", gatewayPath(`https://gateway.pinata.cloud/ipfs/${CID}`), `/ipfs/${CID}`);
eq("nftstorage", gatewayPath(`https://nftstorage.link/ipfs/${CID}/1.json`), `/ipfs/${CID}/1.json`);
eq("a dead gateway host is fine, the CID is what matters", gatewayPath(`https://cloudflare-ipfs.com/ipfs/${CID}`), `/ipfs/${CID}`);
eq("gateway decoration dropped", gatewayPath(`https://ipfs.io/ipfs/${CID}?filename=a.png`), `/ipfs/${CID}`);
eq("fragment dropped", gatewayPath(`https://ipfs.io/ipfs/${CID}#x`), `/ipfs/${CID}`);
eq("subdomain gateway", gatewayPath(`https://${CIDv1}.ipfs.dweb.link/1.json`), `/ipfs/${CIDv1}/1.json`);
eq("subdomain gateway, no path", gatewayPath(`https://${CIDv1}.ipfs.w3s.link`), `/ipfs/${CIDv1}`);
eq("ipns path gateway", gatewayPath("https://ipfs.io/ipns/en.wikipedia-on-ipfs.org"), "/ipns/en.wikipedia-on-ipfs.org");
eq("arweave gateway", gatewayPath(`https://arweave.net/${TXID}/1`), `/ar/${TXID}/1`);
eq("arweave mirror", gatewayPath(`https://g8way.io/${TXID}`), `/ar/${TXID}`);
// CloneX writes the sandboxed subdomain form arweave.net redirects to, and
// the txid is still right there in the path.
eq(
  "arweave sandbox subdomain (CloneX)",
  gatewayPath(
    "https://ohm647fhcdf3f6547mcreqj2pgfdzxba7q54ugunppzk3maqy2ma.arweave.net/NGdLvqHyCPyfGzcODgHhOjenXajH--m6mpkp1JLY8M0/1"
  ),
  "/ar/NGdLvqHyCPyfGzcODgHhOjenXajH--m6mpkp1JLY8M0/1"
);
eq(
  "a lookalike host is not arweave",
  gatewayPath(`https://arweave.net.evil.example/${TXID}`),
  null
);

// The line is the CID itself. Without one, an https URL is the project's own
// claim about where its metadata lives, and proxying it would hide a CORS
// mistake that the token's owner should see and fix.
eq("https is left alone", gatewayPath("https://api.opensea.io/x/1"), null);
eq("http is left alone", gatewayPath("http://a/b"), null);
eq("data is left alone", gatewayPath("data:application/json,{}"), null);
eq("an /ipfs/ path with no CID is not a gateway URL", gatewayPath("https://example.com/ipfs/readme.txt"), null);
eq("a truncated CID is not a CID", gatewayPath("https://ipfs.io/ipfs/QmAbc"), null);
eq("arweave host without a txid", gatewayPath("https://arweave.net/graphql"), null);
eq("a random host with a txid-shaped path", gatewayPath(`https://example.com/${TXID}`), null);
eq("nonsense", gatewayPath("QmAbc"), null);
eq("non-string", gatewayPath(undefined as any), null);
// It is injected verbatim into the token page, so it must not close over
// anything except what the page provides. The one thing the page provides is
// a __name shim, because the bundler's keep-names wraps inner functions in it;
// that is exactly the scope reproduced here, and nothing more.
eq(
  "survives being reconstructed from its own source",
  new Function("const __name = (fn) => fn; return " + gatewayPath.toString())()(
    "ipfs://QmAbc"
  ),
  "/ipfs/QmAbc"
);

section("imageAttempts (what the BROWSER can try, in order)");
// Content-addressed: this origin first, because the courier is ours to pick.
eq("an ipfs URI is read back through us", imageAttempts("ipfs://QmAbc/1.png"), ["/ipfs/QmAbc/1.png"]);
// A hardcoded gateway is a CID wearing a hat: ours first, theirs as a
// last resort, since it is where the bytes were last known to be.
eq("a hardcoded gateway keeps itself as a fallback", imageAttempts("https://ipfs.io/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq"), [
  "/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq",
  "https://ipfs.io/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq",
]);
// Not content-addressed: that URL IS the project's claim about where its art
// lives, so there is nothing for us to substitute and one thing to try.
eq("a project's own host is left alone", imageAttempts("https://img.cryptokitties.co/0xabc/1.svg"), [
  "https://img.cryptokitties.co/0xabc/1.svg",
]);
eq("and so is an inline image", imageAttempts("data:image/svg+xml,%3Csvg%2F%3E"), [
  "data:image/svg+xml,%3Csvg%2F%3E",
]);
// Whatever it returns, the caller shows it in order and never twice.
eq(
  "never the same source twice",
  new Set(imageAttempts("https://ipfs.io/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq")).size,
  imageAttempts("https://ipfs.io/ipfs/QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq").length
);

section("upstreamsFor (the gateway proxy's only decision)");
// One gateway failing says nothing about whether a CID exists, so the proxy
// gets a list rather than a URL.
eq("ipfs, in order", upstreamsFor("ipfs", "QmAbc/0")?.[0], "https://ipfs.io/ipfs/QmAbc/0");
eq("a second gateway to try", upstreamsFor("ipfs", "QmAbc/0")?.[1], "https://dweb.link/ipfs/QmAbc/0");
eq("ipfs with redundant prefix", upstreamsFor("ipfs", "ipfs/QmAbc")?.[0], "https://ipfs.io/ipfs/QmAbc");
eq("leading slashes trimmed", upstreamsFor("ipfs", "//QmAbc")?.[0], "https://ipfs.io/ipfs/QmAbc");
eq("ipns", upstreamsFor("ipns", "example.eth")?.[0], "https://ipfs.io/ipns/example.eth");
eq("arweave", upstreamsFor("ar", "xyz-123")?.[0], "https://arweave.net/xyz-123");
eq("empty", upstreamsFor("ipfs", ""), null);
// The proxy fetches on the visitor's behalf, so it must not be talkable into
// fetching something that is not gateway content.
eq("traversal", upstreamsFor("ipfs", "../etc/passwd"), null);
eq("traversal mid-path", upstreamsFor("ipfs", "QmAbc/../../x"), null);
eq("percent-encoded traversal", upstreamsFor("ipfs", "%2e%2e/%2e%2e/etc"), null);
eq("undecodable percent escape", upstreamsFor("ipfs", "Qm%zz"), null);
eq("absolute URL", upstreamsFor("ipfs", "https://evil.example/x"), null);
eq("protocol-relative", upstreamsFor("ipfs", "/evil.example/x")?.[0], "https://ipfs.io/ipfs/evil.example/x");
eq("backslash", upstreamsFor("ipfs", "Qm\\evil"), null);
eq("query string", upstreamsFor("ipfs", "QmAbc?x=1"), null);
eq("fragment", upstreamsFor("ipfs", "QmAbc#x"), null);
eq("whitespace", upstreamsFor("ipfs", "Qm Abc"), null);

section("what to put behind the art");

// The token decides. Everything else is a fallback, never an override.
eq("a declared background", backgroundColorOf({ background_color: "638596" }), "#638596");
eq("with a hash, as some write it", backgroundColorOf({ background_color: "#638596" }), "#638596");
eq("shorthand", backgroundColorOf({ background_color: "fff" }), "#fff");
eq("with alpha", backgroundColorOf({ background_color: "11223344" }), "#11223344");
eq("a colour name is not the convention", backgroundColorOf({ background_color: "wheat" }), null);
eq("nor an injection attempt", backgroundColorOf({ background_color: "red;} body{display:none" }), null);
eq("nothing declared", backgroundColorOf({ image: "x" }), null);
eq("no metadata at all", backgroundColorOf(null), null);

// A viewer may ask for a backdrop; the same validation applies.
eq("?bg is honoured", requestedBackdrop("?bg=F5DEB3"), "#F5DEB3");
eq("with a hash escaped", requestedBackdrop("?bg=%23112233"), "#112233");
eq("among other params", requestedBackdrop("?strict&bg=fff"), "#fff");
eq("garbage ignored", requestedBackdrop("?bg=url(javascript:alert(1))"), null);
eq("absent", requestedBackdrop("?strict"), null);

// A 4x4 sample, written as rows of [r,g,b,a], so each case is readable.
function sample(rows: number[][][]): number[] {
  const flat: number[] = [];
  for (const row of rows) for (const px of row) flat.push(...px);
  return flat;
}
const CLEAR = [0, 0, 0, 0];
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const SKIN = [174, 139, 97, 255];
const row = (...px: number[][]) => px;

// A CryptoPunk: transparent around it, skin in the middle, black outline.
const punk = backdropStats(
  sample([
    row(CLEAR, CLEAR, CLEAR, CLEAR),
    row(CLEAR, BLACK, SKIN, CLEAR),
    row(CLEAR, SKIN, SKIN, CLEAR),
    row(CLEAR, CLEAR, CLEAR, CLEAR),
  ]),
  4
);
eq("a punk floats", punk.edgeOpaqueRatio, 0);
eq("and draws in black", punk.darkShare > 0.02, true);
// Which is worth SAYING, and never worth acting on: art drawn in black on
// transparency may well have been drawn for a dark backdrop.
eq("so the page can point it out", hidesDarkStrokes(punk), true);

// Art that brings its own background never sees a backdrop at all, so it
// keeps the plate and the card still looks like the site.
const framed = backdropStats(
  sample([
    row(BLACK, BLACK, BLACK, BLACK),
    row(BLACK, WHITE, WHITE, BLACK),
    row(BLACK, WHITE, WHITE, BLACK),
    row(BLACK, BLACK, BLACK, BLACK),
  ]),
  4
);
eq("its edges are opaque", framed.edgeOpaqueRatio, 1);
eq("so there is nothing to point out", hidesDarkStrokes(framed), false);

// Floating art with no dark strokes is perfectly visible on the plate.
const bright = backdropStats(
  sample([
    row(CLEAR, CLEAR, CLEAR, CLEAR),
    row(CLEAR, WHITE, WHITE, CLEAR),
    row(CLEAR, WHITE, SKIN, CLEAR),
    row(CLEAR, CLEAR, CLEAR, CLEAR),
  ]),
  4
);
eq("nothing near-black", bright.darkShare, 0);
eq("nothing to point out either", hidesDarkStrokes(bright), false);

eq("an empty sample says nothing", hidesDarkStrokes(backdropStats(sample([
  row(CLEAR, CLEAR, CLEAR, CLEAR),
  row(CLEAR, CLEAR, CLEAR, CLEAR),
  row(CLEAR, CLEAR, CLEAR, CLEAR),
  row(CLEAR, CLEAR, CLEAR, CLEAR),
]), 4)), false);
eq("and neither does a missing one", hidesDarkStrokes(null), false);

// CryptoPunks: transparent art, black outline, and NO declared backdrop. The
// per-punk colours on larvalabs.com are that site's HTML, not chain data, and
// the canonical punks.png is transparent, so an adapter presenting a document
// as read from the chain must not smuggle them in.
async function punkAdapterChecks() {
  // An ABI-encoded string, the way the renderer answers.
  const encoded = (text: string) => {
    const bytes = Buffer.from(text, "utf8");
    const padded = Math.ceil(bytes.length / 32) * 32;
    return (
      "0x" +
      (32).toString(16).padStart(64, "0") +
      bytes.length.toString(16).padStart(64, "0") +
      bytes.toString("hex").padEnd(padded * 2, "0")
    );
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: any) => {
    const data = JSON.parse(init.body).params[0].data as string;
    const answer = data.startsWith("0x74beb047")
      ? encoded('data:image/svg+xml;utf8,<svg><rect fill="#000000ff"/></svg>')
      : encoded("Male 1, Mohawk Dark, Small Shades");
    return { json: async () => ({ result: answer }) } as any;
  }) as any;

  try {
    const adapter = findAdapter("1", "0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb")!;
    const result = await adapter.read({ ETHEREUM_NODE: "https://node" }, "3862");
    eq("names the punk", result.metadata.name, "CryptoPunk #3862");
    eq(
      "re-encodes the renderer's hand-built data URI",
      result.metadata.image,
      "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3Crect%20fill%3D%22%23000000ff%22%2F%3E%3C%2Fsvg%3E"
    );
    eq("reads the attributes", result.metadata.attributes?.length, 3);
    eq("first is the type", result.metadata.attributes?.[0], {
      trait_type: "Type",
      value: "Male 1",
    });
    // The colours larvalabs.com puts behind each punk are that page's HTML,
    // not chain data, and the canonical punks.png is transparent. A document
    // presented as read from the chain must not smuggle them in.
    eq("invents no backdrop", "background_color" in result.metadata, false);
    eq("and says where the art came from", result.source.address, "0x16f5a35647d6f03d5d3da7b35409d65ba03af3b2");
    eq("and that we assembled it", result.note.includes("assembled by"), true);

    let rejected = false;
    try {
      await adapter.read({ ETHEREUM_NODE: "https://node" }, "10000");
    } catch {
      rejected = true;
    }
    eq("there is no punk 10000", rejected, true);
  } finally {
    globalThis.fetch = realFetch;
  }
}

await punkAdapterChecks();

section("adapters (the whole list of exceptions)");

// Every entry is an exception, so every entry has to justify itself and say
// where its data comes from. A future adapter that forgets is caught here.
for (const adapter of ADAPTERS) {
  eq(`${adapter.collection}: address is lowercase`, adapter.contract, adapter.contract.toLowerCase());
  eq(`${adapter.collection}: address is well formed`, /^0x[0-9a-f]{40}$/.test(adapter.contract), true);
  eq(`${adapter.collection}: chain is numeric`, /^[0-9]+$/.test(adapter.chainId), true);
  eq(`${adapter.collection}: says why it exists`, adapter.reason.length > 30, true);
  eq(`${adapter.collection}: is a function`, typeof adapter.read, "function");
  // What an adapter writes is cached, so changing what it writes has to
  // invalidate what it wrote before.
  eq(`${adapter.collection}: is versioned`, Number.isInteger(adapter.version), true);
}

const PUNKS = "0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb";
eq("cryptopunks is covered", findAdapter("1", PUNKS)?.collection, "CryptoPunks");
eq("matching ignores case", findAdapter("1", PUNKS.toUpperCase())?.collection, "CryptoPunks");
eq("the same address on another chain is not", findAdapter("137", PUNKS), null);
eq("an ordinary collection is untouched", findAdapter("1", "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d"), null);

// The renderer answers with a data: URI it built by hand: a media type
// parameter RFC 2397 does not define, and markup that is not percent-encoded,
// so the first '#' in a fill colour would end the URL.
eq(
  "the renderer's hand-built data URI is re-encoded",
  reencodeSvgDataURI('data:image/svg+xml;utf8,<svg fill="#abc"/>'),
  "data:image/svg+xml;charset=utf-8,%3Csvg%20fill%3D%22%23abc%22%2F%3E"
);
eq(
  "bare markup is wrapped just the same",
  reencodeSvgDataURI('<svg fill="#abc"/>'),
  "data:image/svg+xml;charset=utf-8,%3Csvg%20fill%3D%22%23abc%22%2F%3E"
);
eq("nothing is lost in the round trip", decodeURIComponent(reencodeSvgDataURI('data:image/svg+xml;utf8,<svg/>').split(",")[1]), "<svg/>");

// punkAttributes answers with one string: the type, then accessories.
eq("a punk with accessories", punkAttributes("Male 1, Smile, Mohawk"), [
  { trait_type: "Type", value: "Male 1" },
  { trait_type: "Accessory", value: "Smile" },
  { trait_type: "Accessory", value: "Mohawk" },
]);
eq("an alien with one", punkAttributes("Alien, Headband"), [
  { trait_type: "Type", value: "Alien" },
  { trait_type: "Accessory", value: "Headband" },
]);
eq("a bare punk", punkAttributes("Female 3"), [{ trait_type: "Type", value: "Female 3" }]);
eq("nothing at all", punkAttributes(""), []);

section("getEndpoints / isGasCapError");
eq("a single node", getEndpoints({ ETHEREUM_NODE: "https://a" }, "1"), ["https://a"]);
eq(
  "a comma-separated list, in order",
  getEndpoints({ ETHEREUM_NODE: "https://a, https://b ,https://c" }, "1"),
  ["https://a", "https://b", "https://c"]
);
eq(
  "per-chain overrides the default",
  getEndpoints({ ETHEREUM_NODE: "https://a", ETHEREUM_NODE_137: "https://p" }, "137"),
  ["https://p"]
);
eq("trailing commas ignored", getEndpoints({ ETHEREUM_NODE: "https://a,," }, "1"), ["https://a"]);
let threw = false;
try { getEndpoints({}, "1"); } catch { threw = true; }
eq("no node configured is an error", threw, true);

// The Non-Fungible Moons case: a node capping the gas an eth_call may burn.
eq(
  "the wording geth uses",
  isGasCapError("out of gas: gas exhausted during memory expansion: 550000000"),
  true
);
eq("and the other common wording", isGasCapError("gas required exceeds allowance"), true);
eq("a revert is not a gas cap", isGasCapError("execution reverted"), false);
eq("nor is a dead node", isGasCapError("fetch failed"), false);

section("ethCall across several nodes");

async function rpcChecks() {
  const realFetch = globalThis.fetch;
  const plan: Record<string, any> = {};
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    const answer = plan[String(url)];
    if (answer === "down") throw new Error("connection refused");
    return { json: async () => answer } as any;
  }) as any;

  try {
    plan["https://a"] = { result: "0xabc" };
    plan["https://b"] = { result: "0xdef" };
    eq("the first node that answers wins", await ethCall(["https://a", "https://b"], "0x1", "0x2"), "0xabc");
    eq("and the rest are not asked", asked, ["https://a"]);

    // The point of the list: one node's gas cap is not the token's problem.
    asked.length = 0;
    plan["https://a"] = {
      error: { code: -32003, message: "out of gas: gas exhausted during memory expansion: 550000000" },
    };
    eq("a refusal moves to the next node", await ethCall(["https://a", "https://b"], "0x1", "0x2"), "0xdef");
    eq("both were asked", asked, ["https://a", "https://b"]);

    asked.length = 0;
    plan["https://b"] = "down";
    let error: any;
    try {
      await ethCall(["https://a", "https://b"], "0x1", "0x2");
    } catch (err) {
      error = err;
    }
    eq("every node refusing is an error", error instanceof RpcError, true);
    eq("which knows it was about gas", error.gasCapped, true);
    eq("and says what each node said", error.message.includes("out of gas"), true);
    eq("including the one that was simply down", error.message.includes("connection refused"), true);
    // Hosts, not URLs: an endpoint usually carries an API key.
    eq("without leaking the endpoint", error.message.includes("https://a"), false);

    plan["https://a"] = { error: { message: "execution reverted" } };
    plan["https://b"] = { error: { message: "execution reverted" } };
    try {
      await ethCall(["https://a", "https://b"], "0x1", "0x2");
    } catch (err: any) {
      error = err;
    }
    eq("a revert everywhere is not blamed on gas", error.gasCapped, false);
  } finally {
    globalThis.fetch = realFetch;
  }
}

await rpcChecks();

section("fetchFirstAvailable (a CID that nobody pins any more)");

// A fake network: each URL maps to a status, or to "hang" for a gateway that
// holds the connection open while it looks for a provider that is not there.
function fakeNetwork(plan: Record<string, number | "hang">, clock: { t: number }) {
  const tried: string[] = [];
  const fetcher = async (url: string, _init: any, timeoutMs: number) => {
    tried.push(url);
    const outcome = plan[url];
    if (outcome === "hang") {
      clock.t += timeoutMs; // burned the whole allowance and got nothing
      throw new Error("aborted");
    }
    clock.t += 50;
    return { ok: outcome === 200, status: outcome } as Response;
  };
  return { tried, fetcher };
}

async function budgetChecks() {
  const now = () => clock.t;
  let clock = { t: 0 };

  // The happy case: the first gateway answers and the rest are never asked.
  let net = fakeNetwork({ a: 200, b: 200 }, clock);
  let result = await fetchFirstAvailable(["a", "b"], {}, { now }, net.fetcher);
  eq("stops at the first answer", net.tried, ["a"]);
  eq("returns it", result.response?.status, 200);

  // A gateway that does not have it should not end the search.
  clock = { t: 0 };
  net = fakeNetwork({ a: 504, b: 200 }, clock);
  result = await fetchFirstAvailable(["a", "b"], {}, { now }, net.fetcher);
  eq("a refusal moves on", net.tried, ["a", "b"]);
  eq("and the next answer wins", result.response?.status, 200);

  // The CityDAO case: every gateway hangs. Each burns its per-attempt
  // allowance, and the total budget stops us before the list is exhausted, so
  // "gone" is a conclusion reached in seconds rather than minutes.
  clock = { t: 0 };
  net = fakeNetwork({ a: "hang", b: "hang", c: "hang" }, clock);
  result = await fetchFirstAvailable(
    ["a", "b", "c"],
    {},
    { perAttemptMs: 12000, totalMs: 25000, now },
    net.fetcher
  );
  eq("unpinned content gives no response", result.response, undefined);
  eq("two attempts fit the budget", net.tried, ["a", "b"]);
  eq("the third is skipped, not waited on", result.attempts[2].outcome, "skipped: out of time");
  eq("and it took the budget, not the network's patience", clock.t <= 25000, true);

  // A definite "no such content" is kept, because it means something a
  // timeout does not: the source answered.
  clock = { t: 0 };
  net = fakeNetwork({ a: "hang", b: 404 }, clock);
  result = await fetchFirstAvailable(["a", "b"], {}, { now }, net.fetcher);
  eq("no successful response", result.response, undefined);
  eq("but the refusal is reported", result.last?.status, 404);

  eq("every attempt is accounted for", result.attempts.map((a) => a.url), ["a", "b"]);
}

await budgetChecks();

section("outboundHeaders (hosting other people's bytes on our own name)");
const upstreamHeaders = new Headers({
  "content-type": "text/html",
  etag: '"abc"',
  "set-cookie": "tracker=1",
  "content-security-policy": "default-src 'none'",
});
const ipfsHeaders = outboundHeaders("ipfs", upstreamHeaders);
eq("content-type kept", ipfsHeaders.get("content-type"), "text/html");
eq("etag kept", ipfsHeaders.get("etag"), '"abc"');
eq("upstream cookies dropped", ipfsHeaders.get("set-cookie"), null);
// Some NFT art IS an HTML document. Served from embed.art it would otherwise
// run AS embed.art, which a public gateway used to prevent just by being
// somewhere else.
eq(
  "the document gets an opaque origin",
  ipfsHeaders.get("content-security-policy"),
  "sandbox allow-scripts"
);
eq("no content sniffing", ipfsHeaders.get("x-content-type-options"), "nosniff");
eq("a CID is immutable", ipfsHeaders.get("cache-control"), "public, max-age=29030400, immutable");
// An IPNS name is a pointer its owner can move, so it is cached like one.
eq("an IPNS name is not", outboundHeaders("ipns", upstreamHeaders).get("cache-control"), "public, max-age=60");
eq("readable by any page", ipfsHeaders.get("access-control-allow-origin"), "*");



section("audioSource (which animation_url counts as audio)");
eq("inline wav", audioSource({ animation_url: "data:audio/wav;base64,AA" }), "data:audio/wav;base64,AA");
eq("mp3 by extension", audioSource({ animation_url: "https://x/y.mp3" }), "https://x/y.mp3");
eq("uppercase extension", audioSource({ animation_url: "https://x/Y.WAV" }), "https://x/Y.WAV");
eq("html animation is not audio", audioSource({ animation_url: "https://x/y.html" }), null);
eq("inline html is not audio", audioSource({ animation_url: "data:text/html,<b>" }), null);
eq("no animation_url", audioSource({ image: "https://x/y.png" }), null);
eq("empty metadata", audioSource({}), null);

section("dataURIDocument (the header is a structure, not a prefix)");
// The forms the standard describes.
eq(
  "the plain one",
  dataURIDocument('data:application/json,{"name":"a"}'),
  '{"name":"a"}'
);
eq(
  "charset stated",
  dataURIDocument('data:text/plain;charset=utf-8,{"name":"a"}'),
  '{"name":"a"}'
);
eq("base64", dataURIDocument("data:application/json;base64,eyJhIjoxfQ=="), '{"a":1}');
// atob would return one character per byte and mangle this; Base64.decode
// reads it as the UTF-8 it is.
eq(
  "base64 holding UTF-8",
  dataURIDocument("data:application/json;base64," + Buffer.from('{"n":"caf\u00e9"}').toString("base64")),
  '{"n":"caf\u00e9"}'
);
// RFC 2397: no media type means text/plain.
eq("no media type at all", dataURIDocument('data:,{"name":"a"}'), '{"name":"a"}');
// The parameter onchain renderers invent. [sol]Seedlings writes exactly this,
// and matching whole prefixes sent it to the error page over a token that was
// perfectly readable.
eq(
  "the ;utf8 parameter nothing defines",
  dataURIDocument('data:application/json;utf8,{"name":"Genesis.sol #460"}'),
  '{"name":"Genesis.sol #460"}'
);
eq(
  "an unencoded # is kept, because the string is read and never fetched",
  dataURIDocument("data:text/plain,{\"image\":\"<svg fill='#eee'/>\"}"),
  "{\"image\":\"<svg fill='#eee'/>\"}"
);
// Art is not a metadata document: say unsupported rather than "invalid JSON"
// about something that never claimed to be JSON.
throws("an image is not a document", () => dataURIDocument("data:image/svg+xml,<svg/>"));
throws("no comma, no document", () => dataURIDocument("data:application/json"));

// End to end, on the shape the chain actually returns.
const seedlings =
  "data:application/json;utf8," +
  '{"name":"Genesis.sol #460","image":"data:image/svg+xml;utf8,' +
  "<svg xmlns='http://www.w3.org/2000/svg'><rect fill='#000'/></svg>\"}";
const seedlingsMetadata = await parseMetadata(seedlings);
eq("a ;utf8 document parses", seedlingsMetadata.name, "Genesis.sol #460");

section("encodedDataURI (the artwork's own envelope)");
// Same breach as the document's, one level down: intact as a string, cut at
// the '#' the moment an <img> or a CSS url() parses it as a URL.
const repaired = encodedDataURI(seedlingsMetadata.image!)!;
eq(
  "the media type survives, the payload is encoded",
  repaired.slice(0, 34),
  "data:image/svg+xml;charset=utf-8,%"
);
eq(
  "and every byte survives a URL parser",
  decodeURIComponent(repaired.slice(repaired.indexOf(",") + 1)),
  "<svg xmlns='http://www.w3.org/2000/svg'><rect fill='#000'/></svg>"
);
eq(
  "a URL parser now keeps the whole document",
  new URL(repaired).href.length,
  repaired.length
);
// A URI we rewrite for no reason is a URI we broke for no reason.
eq("nothing to repair, nothing repaired", encodedDataURI("data:image/svg+xml,%3Csvg%2F%3E"), null);
eq("base64 has no '#' to lose", encodedDataURI("data:image/png;base64,iVBOR#"), null);
eq("an http URL is not ours to touch", encodedDataURI("https://x/y.svg#a"), null);
eq("markup is not a URI", encodedDataURI("<svg fill='#eee'/>"), null);
// Partially encoded and still carrying a bare '#': decode first, or the
// escapes it already has get encoded twice.
eq(
  "already-encoded escapes are not doubled",
  encodedDataURI("data:image/svg+xml,%3Csvg%3E#eee"),
  "data:image/svg+xml;charset=utf-8,%3Csvg%3E%23eee"
);
// A media URI inside a data: document is read as a URL TWICE: once when the
// page fetches the document, once when the <img> fetches the artwork. Bleeps
// writes `%2520` for exactly that reason, so two decodes land on the space it
// meant, and a repair that decoded once and re-encoded once would eat a pass
// and deliver `%20` into the SVG. The round trip has to be exact.
const doubleEncoded = "data:image/svg+xml,%253Csvg%2520fill='#eee'%253E";
eq(
  "a payload encoded for two passes survives the repair",
  encodedDataURI(doubleEncoded),
  "data:image/svg+xml;charset=utf-8,%253Csvg%2520fill%3D'%23eee'%253E"
);
eq(
  "which is to say the second pass still sees what it did before",
  decodeURIComponent(
    decodeURIComponent(encodedDataURI(doubleEncoded)!.split(",").slice(1).join(","))
  ),
  "<svg fill='#eee'>"
);

section("isRenderable (is there anything to screenshot?)");
eq("image only", isRenderable({ image: "https://x/a.png" }), true);
eq("animation only", isRenderable({ animation_url: "https://x/a.html" }), true);
eq("both", isRenderable({ image: "a", animation_url: "b" }), true);
eq("name but no media", isRenderable({ name: "Tok", description: "d" }), false);
// OpenSea answers a missing token with HTTP 404 and a JSON error body; parsed
// as metadata it yields this, and the old code spent 30s screenshotting it.
eq("a 404 error body", isRenderable({ errors: ["not found"] } as any), false);
eq("empty object", isRenderable({}), false);
eq("null", isRenderable(null as any), false);

report();
