/**
 * The front page's URL builder.
 *
 * It is the only part of the service a visitor drives by hand, and it now does
 * two things that can be silently wrong: converting a hex token id to the
 * decimal the path requires, and refusing to put an unresolved ENS name where
 * an address belongs. Both are pure string work, so they are checked here
 * rather than by loading the page and squinting at it.
 */
// @ts-ignore - a plain UMD script, deliberately not TypeScript: the browser
// loads this exact file.
import builder from "../public/static/builder.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, report, section } from "./assert";

const {
  KNOWN,
  ensNameOf,
  findKnown,
  hexToDecimal,
  isAddress,
  normalizeTokenId,
  tokenPath,
} = builder as any;

const BLEEPS = "0x9d27527Ada2CF29fBDAB2973cfa243845a08Bd3F";

section("hexToDecimal");
eq("zero", hexToDecimal("0x0"), "0");
eq("single digit", hexToDecimal("0xa"), "10");
eq("4508, as an explorer shows it", hexToDecimal("0x119c"), "4508");
eq("uppercase hex", hexToDecimal("0xFF"), "255");
eq("no prefix", hexToDecimal("ff"), "255");
// Past 2^53: this is why the conversion is done digit by digit rather than
// with parseInt, which would round it to something that is not a token.
eq(
  "a Mandalas id (40 hex digits)",
  hexToDecimal("0x8fcd7d5cdd69e81026609266db8226110c530b3e"),
  "820968253629536341503692254232196410315455531838"
);

section("normalizeTokenId");
eq("decimal passes through", normalizeTokenId("4508"), { id: "4508", hex: false });
eq("hex is converted", normalizeTokenId("0x119c"), { id: "4508", hex: true });
eq("surrounding space", normalizeTokenId("  7  "), { id: "7", hex: false });
eq("leading zeros dropped", normalizeTokenId("007"), { id: "7", hex: false });
eq("zero survives", normalizeTokenId("0"), { id: "0", hex: false });
eq("hex zero survives", normalizeTokenId("0x0"), { id: "0", hex: true });
eq("uppercase 0X prefix", normalizeTokenId("0X1F"), { id: "31", hex: true });
eq("empty", normalizeTokenId("").error, "empty");
eq("null", normalizeTokenId(null).error, "empty");
eq("bare 0x", normalizeTokenId("0x").error, "not a number");
eq("not a number", normalizeTokenId("twelve").error, "not a number");
eq("negative", normalizeTokenId("-1").error, "not a number");
eq("decimal point", normalizeTokenId("1.5").error, "not a number");

section("tokenPath");
eq(
  "complete",
  tokenPath({ chain: "1", standard: "erc721", contract: BLEEPS, token: "1" }),
  `eip155:1/erc721:${BLEEPS}/1`
);
eq(
  "hex id becomes decimal in the path",
  tokenPath({ chain: "1", standard: "erc721", contract: BLEEPS, token: "0x119c" }),
  `eip155:1/erc721:${BLEEPS}/4508`
);
eq(
  "erc1155 kept",
  tokenPath({ chain: "137", standard: "erc1155", contract: BLEEPS, token: "1" }),
  `eip155:137/erc1155:${BLEEPS}/1`
);
eq(
  "chain defaults to mainnet",
  tokenPath({ chain: "", standard: "erc721", contract: BLEEPS, token: "1" }),
  `eip155:1/erc721:${BLEEPS}/1`
);
eq(
  "unknown standard falls back to erc721",
  tokenPath({ chain: "1", standard: "erc20", contract: BLEEPS, token: "1" }),
  `eip155:1/erc721:${BLEEPS}/1`
);
// The whole point of resolving here: a name is a mutable pointer, so it must
// never reach the URL. Until it resolves the path stays incomplete, which is
// what disables the open button.
eq(
  "an ENS name is never pasted into the path",
  tokenPath({ chain: "1", standard: "erc721", contract: "bleeps.eth", token: "1" }),
  "eip155:1/erc721:<contract>/1"
);
eq(
  "a half-typed address is not an address",
  tokenPath({ chain: "1", standard: "erc721", contract: "0x9d27", token: "1" }),
  "eip155:1/erc721:<contract>/1"
);
eq(
  "missing token id",
  tokenPath({ chain: "1", standard: "erc721", contract: BLEEPS, token: "" }),
  `eip155:1/erc721:${BLEEPS}/<tokenId>`
);

section("isAddress / ensNameOf");
eq("address", isAddress(BLEEPS), true);
eq("address with space", isAddress(` ${BLEEPS} `), true);
eq("too short", isAddress("0x9d27"), false);
eq("a name is not an address", isAddress("bleeps.eth"), false);
eq("name lowercased", ensNameOf("Bleeps.ETH"), "bleeps.eth");
eq("subname", ensNameOf("sub.bleeps.eth"), "sub.bleeps.eth");
eq("not .eth", ensNameOf("bleeps.xyz"), null);
eq("an address is not a name", ensNameOf(BLEEPS), null);
eq("path-like input rejected", ensNameOf("a/b.eth"), null);

section("known collections");
const seen = new Set<string>();
for (const entry of KNOWN) {
  eq(`${entry.name}: address is well formed`, isAddress(entry.contract), true);
  eq(`${entry.name}: address is not duplicated`, seen.has(entry.contract.toLowerCase()), false);
  seen.add(entry.contract.toLowerCase());
  eq(`${entry.name}: standard is supported`, ["erc721", "erc1155"].includes(entry.standard), true);
  eq(`${entry.name}: chain is numeric`, /^[0-9]+$/.test(entry.chain), true);
  // The list exists for collections you can pick a token out of by typing a
  // small number. An entry whose sample id is not one does not belong.
  eq(`${entry.name}: sample id is a small number`, /^[0-9]{1,7}$/.test(entry.token), true);
  eq(`${entry.name}: has a note`, typeof entry.note === "string" && entry.note.length > 0, true);
}
eq("bleeps is offered", !!findKnown(BLEEPS), true);
eq("lookup is case-insensitive", findKnown(BLEEPS.toLowerCase())!.name, "Bleeps");
eq("unknown address", findKnown("0x0000000000000000000000000000000000000001"), null);
// Mandalas is onchain art and on the front page, but its ids are 40-digit
// numbers that only exist once minted, so it is not something to offer here.
eq(
  "mandalas is deliberately absent",
  !!findKnown("0xDaCa87395f3b1Bbc46F3FA187e996E03a5dCc985"),
  false
);

section("page and script agree");
// Relative to the repo root: the test runner bundles this file into a temp
// directory, so import.meta.url points at the bundle, not at the source.
const html = readFileSync(join(process.cwd(), "public", "index.html"), "utf8");
eq("page loads the builder", html.includes('src="/static/builder.js"'), true);
eq("no inline builder script left behind", html.includes("function build()"), false);
for (const id of ["known", "chain", "standard", "contract", "token", "out", "open", "copy", "ens"]) {
  eq(`#${id} exists in the markup`, html.includes(`id="${id}"`), true);
}
for (const id of ["contract-hint", "token-hint", "builder-note"]) {
  eq(`#${id} exists in the markup`, html.includes(`id="${id}"`), true);
}
// The note is about the contract and token id fields. In ENS mode those are
// hidden, so advice about them reads as advice about the name field, and its
// bleeps.eth example would suggest that name has an avatar. It does not.
const builderSource = readFileSync(
  join(process.cwd(), "public", "static", "builder.js"),
  "utf8"
);
eq("the note is hidden in ENS mode", builderSource.includes("note.hidden = ens"), true);

report();
