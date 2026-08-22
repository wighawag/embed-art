/**
 * Offline checks for the pure parsing/encoding functions. No network, no
 * bindings. These are the places where a wrong character silently produces a
 * page that says "unreadable" about a perfectly good token.
 */
import { outboundHeaders, upstreamFor } from "../functions/_handlers/gateway";
import { audioSource } from "../functions/_handlers/media";
import { gatewayPath, gatewayURI } from "../functions/_utils/url";
import { isEnsName, normalizeEnsName, parseAvatarRecord } from "../functions/_utils/ens";
import { erc1155IdHex, isRenderable } from "../functions/_utils/metadata";
import { parseTokenSegment } from "../functions/_utils/url";
import { eq, report, section } from "./assert";

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
eq("ipfs", gatewayURI("ipfs://QmAbc"), "https://ipfs.io/ipfs/QmAbc");
eq("ipfs with redundant prefix", gatewayURI("ipfs://ipfs/QmAbc"), "https://ipfs.io/ipfs/QmAbc");
eq("ipns", gatewayURI("ipns://example.eth"), "https://ipfs.io/ipns/example.eth");
eq("arweave", gatewayURI("ar://xyz"), "https://arweave.net/xyz");
eq("https untouched", gatewayURI("https://a/b.png"), "https://a/b.png");
eq("data untouched", gatewayURI("data:image/png;base64,AA"), "data:image/png;base64,AA");

section("gatewayPath (what the BROWSER is given)");
// A CID is content: where it is fetched from is nobody's claim, so it comes
// back through this origin, where no gateway can challenge the browser.
eq("ipfs", gatewayPath("ipfs://QmAbc/0"), "/ipfs/QmAbc/0");
eq("ipfs with redundant prefix", gatewayPath("ipfs://ipfs/QmAbc"), "/ipfs/QmAbc");
eq("ipns", gatewayPath("ipns://example.eth"), "/ipns/example.eth");
eq("arweave", gatewayPath("ar://xyz"), "/ar/xyz");
// The opposite case, and the important one: an https URL IS the project's
// claim about where its metadata lives. Proxying it would hide a CORS
// mistake that the token's owner should see and fix.
eq("https is left alone", gatewayPath("https://api.opensea.io/x/1"), null);
eq("http is left alone", gatewayPath("http://a/b"), null);
eq("data is left alone", gatewayPath("data:application/json,{}"), null);
eq("an ipfs gateway URL is left alone", gatewayPath("https://ipfs.io/ipfs/QmAbc"), null);
eq("nonsense", gatewayPath("QmAbc"), null);
eq("non-string", gatewayPath(undefined as any), null);
// It is injected verbatim into the token page, so it must not close over
// anything: called with no scope of its own it still has to work.
eq(
  "survives being reconstructed from its own source",
  new Function("return " + gatewayPath.toString())()("ipfs://QmAbc"),
  "/ipfs/QmAbc"
);

section("upstreamFor (the gateway proxy's only decision)");
eq("ipfs", upstreamFor("ipfs", "QmAbc/0"), "https://ipfs.io/ipfs/QmAbc/0");
eq("ipfs with redundant prefix", upstreamFor("ipfs", "ipfs/QmAbc"), "https://ipfs.io/ipfs/QmAbc");
eq("leading slashes trimmed", upstreamFor("ipfs", "//QmAbc"), "https://ipfs.io/ipfs/QmAbc");
eq("ipns", upstreamFor("ipns", "example.eth"), "https://ipfs.io/ipns/example.eth");
eq("arweave", upstreamFor("ar", "xyz-123"), "https://arweave.net/xyz-123");
eq("empty", upstreamFor("ipfs", ""), null);
// The proxy fetches on the visitor's behalf, so it must not be talkable into
// fetching something that is not gateway content.
eq("traversal", upstreamFor("ipfs", "../etc/passwd"), null);
eq("traversal mid-path", upstreamFor("ipfs", "QmAbc/../../x"), null);
eq("percent-encoded traversal", upstreamFor("ipfs", "%2e%2e/%2e%2e/etc"), null);
eq("undecodable percent escape", upstreamFor("ipfs", "Qm%zz"), null);
eq("absolute URL", upstreamFor("ipfs", "https://evil.example/x"), null);
eq("protocol-relative", upstreamFor("ipfs", "/evil.example/x"), "https://ipfs.io/ipfs/evil.example/x");
eq("backslash", upstreamFor("ipfs", "Qm\\evil"), null);
eq("query string", upstreamFor("ipfs", "QmAbc?x=1"), null);
eq("fragment", upstreamFor("ipfs", "QmAbc#x"), null);
eq("whitespace", upstreamFor("ipfs", "Qm Abc"), null);

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
