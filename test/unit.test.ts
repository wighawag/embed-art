/**
 * Offline checks for the pure parsing/encoding functions. No network, no
 * bindings. These are the places where a wrong character silently produces a
 * page that says "unreadable" about a perfectly good token.
 */
import { gatewayURI } from "../functions/_handlers/ens";
import { audioSource } from "../functions/_handlers/media";
import { isEnsName, parseAvatarRecord } from "../functions/_utils/ens";
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

section("gatewayURI");
eq("ipfs", gatewayURI("ipfs://QmAbc"), "https://ipfs.io/ipfs/QmAbc");
eq("ipfs with redundant prefix", gatewayURI("ipfs://ipfs/QmAbc"), "https://ipfs.io/ipfs/QmAbc");
eq("arweave", gatewayURI("ar://xyz"), "https://arweave.net/xyz");
eq("https untouched", gatewayURI("https://a/b.png"), "https://a/b.png");
eq("data untouched", gatewayURI("data:image/png;base64,AA"), "data:image/png;base64,AA");



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
