/**
 * Collections that cannot answer `tokenURI` at all, and what to read instead.
 *
 * These are exceptions, and they are kept in one list so they read as
 * exceptions: each entry says which collection it covers, why an exception is
 * warranted, and exactly where the data is read from. Adding one is appending
 * to `ADAPTERS`; removing one is deleting from it. Nothing else in the service
 * knows any collection by name.
 *
 * Two rules keep this from becoming a pile of special cases:
 *
 *  1. An adapter runs ONLY when the standard has nothing to offer, and never
 *     under `?strict`, which always shows what a compliant client sees. A
 *     token whose `tokenURI` answers with a METADATA DOCUMENT is never
 *     touched. Two ways there can be none: CryptoPunks has no `tokenURI` at
 *     all, and Autoglyphs' returns the artwork itself, as text. Neither
 *     leaves a document to override, which is the whole test.
 *  2. Whatever an adapter produces is disclosed on the page: which contract
 *     was called, which function, and that the document was assembled here
 *     rather than returned by the token. A viewer should never have to guess
 *     where a picture came from.
 *  3. An adapter may only name a source it can justify, and must say what kind
 *     it is. Onchain where there is one. Where there is not, the project's own
 *     published location and NEVER a URL we guessed: CryptoKitties keeps its
 *     genes onchain and its drawings on a company's image host, so that is
 *     what the page says, in those words. An adapter that quietly sourced art
 *     from a third party would be laundering it through our name.
 */
import { Metadata } from "./metadata";
import { ethCall, getEndpoints } from "./rpc";

/** What an adapter produced, and where it came from. */
export type AdapterResult = {
  metadata: Metadata;
  /** shown to the visitor, in their own words, not ours */
  note: string;
  /** the contract and function the art was actually read from */
  source: { address: string; method: string };
};

export type Adapter = {
  collection: string;
  chainId: string;
  /** lowercase */
  contract: string;
  /** why this collection cannot be served the ordinary way */
  reason: string;
  /**
   * Bump when what this adapter produces changes.
   *
   * What an adapter returns is cached like any other token document, so
   * without this an edit here is invisible for as long as the cache lives:
   * the fix ships, the pages keep the old document, and nothing says why.
   */
  version: number;
  read(env: any, tokenID: string): Promise<AdapterResult>;
};

/** ABI-decode a single returned string. */
function decodeString(hex: string): string {
  const bytes = hexToBytes(hex);
  const offset = Number(bigEndian(bytes.subarray(0, 32)));
  const length = Number(bigEndian(bytes.subarray(offset, offset + 32)));
  return new TextDecoder().decode(
    bytes.subarray(offset + 32, offset + 32 + length)
  );
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bigEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function uint256(value: string): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

/**
 * A `data:` URI the renderer built by hand, made fetchable.
 *
 * CryptoPunks' renderer returns `data:image/svg+xml;utf8,<svg …>`: the media
 * type parameter is not one RFC 2397 defines, and the markup is not
 * percent-encoded, so the first `#` in a fill colour would end the URL. The
 * bytes are right; the envelope is not, so it is rewritten.
 *
 * Deliberately not `clientCourtesy.encodedDataURI`, which is the same repair
 * made TO a token's own document and is therefore conditional, disclosed and
 * withdrawn by `?strict`. This one is part of assembling a document here, so
 * there is nothing to disclose and nothing to withdraw: we are the author.
 */
export function reencodeSvgDataURI(value: string): string {
  const comma = value.indexOf(",");
  const svg =
    comma !== -1 && /^data:image\/svg\+xml/i.test(value)
      ? value.slice(comma + 1)
      : value;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/**
 * `punkAttributes` answers with one string: the type first, then accessories.
 * "Male 1, Smile, Mohawk" is a type and two accessories.
 */
export function punkAttributes(raw: string): Metadata["attributes"] {
  const parts = String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((value, index) => ({
    trait_type: index === 0 ? "Type" : "Accessory",
    value,
  }));
}

const CRYPTOPUNKS_RENDERER = "0x16f5a35647d6f03d5d3da7b35409d65ba03af3b2";
const PUNK_IMAGE_SVG = "0x74beb047";
const PUNK_ATTRIBUTES = "0x76dfe297";

const cryptopunks: Adapter = {
  collection: "CryptoPunks",
  chainId: "1",
  contract: "0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb",
  version: 2,
  reason:
    "CryptoPunks predates ERC-721: the contract has no tokenURI to call, so " +
    "there is no metadata document to read.",
  async read(env: any, tokenID: string): Promise<AdapterResult> {
    const index = BigInt(tokenID);
    if (index < 0n || index > 9999n) {
      throw new Error(`no such punk: ${tokenID}`);
    }
    const endpoints = getEndpoints(env, "1");
    const [image, attributes] = await Promise.all([
      ethCall(
        endpoints,
        CRYPTOPUNKS_RENDERER,
        PUNK_IMAGE_SVG + uint256(tokenID)
      ).then(decodeString),
      ethCall(
        endpoints,
        CRYPTOPUNKS_RENDERER,
        PUNK_ATTRIBUTES + uint256(tokenID)
      )
        .then(decodeString)
        .catch(() => ""),
    ]);

    return {
      metadata: {
        name: `CryptoPunk #${tokenID}`,
        description:
          "One of 10,000 CryptoPunks. The image is drawn onchain by the " +
          "official renderer; the contract itself stores no metadata.",
        image: reencodeSvgDataURI(image),
        attributes: punkAttributes(attributes),
        // Deliberately no background_color. Larva Labs' site shows each punk
        // on a colour of its own (#638596 for punk 0, #95554f for 3862), but
        // that lives in their page's HTML, not onchain, and the canonical
        // punks.png is transparent. Copying it here would put a central
        // server's styling into a document we present as read from the chain,
        // which is the one thing an adapter must not do.
      },
      // Only what the reason and the source rows do not already say: this is
      // printed next to them, and a note that repeats them is noise.
      note:
        "A punk is transparent and outlined in black. The renderer says " +
        "nothing about what belongs behind it, so neither do we.",
      source: {
        address: CRYPTOPUNKS_RENDERER,
        method: "punkImageSvg(uint16) + punkAttributes(uint16)",
      },
    };
  },
};

const AUTOGLYPHS_CELL = 10;
/** Two cells of paper around the art, so it is not flush to the edge. */
const AUTOGLYPHS_MARGIN = 20;

/**
 * One Autoglyph character, drawn the way the collection draws it.
 *
 * Not invented here. Larva Labs publish an SVG per glyph
 * (`larvalabs.com/public/images/autoglyphs/glyph<N>.svg`) and every symbol in
 * it is a vector primitive on a 10-unit grid, never a letter: `/` and `\` are
 * the cell's diagonals, `X` is both, `|` and `-` are its centre lines, `+` is
 * both, `O` is the inscribed circle, `#` is the filled cell, and `.` is
 * nothing at all. This mapping was read back off those files rather than
 * guessed, because the alternative (setting the characters in a monospace
 * font) renders a transcription of the artwork instead of the artwork: the
 * strokes stop at the glyph's side bearings and the diagonals never join.
 *
 * Appends to `strokes` (line work) and `fills` (solid cells), both SVG path
 * data, and returns a circle when the symbol is one.
 */
export function autoglyphSymbol(
  symbol: string,
  x: number,
  y: number
): { stroke: string; fill: string; circle: boolean } {
  const e = AUTOGLYPHS_CELL;
  const m = e / 2;
  const backslash = `M${x} ${y}l${e} ${e}`;
  const slash = `M${x + e} ${y}l${-e} ${e}`;
  const bar = `M${x + m} ${y}v${e}`;
  const dash = `M${x} ${y + m}h${e}`;
  switch (symbol) {
    case "\\":
      return { stroke: backslash, fill: "", circle: false };
    case "/":
      return { stroke: slash, fill: "", circle: false };
    case "X":
      return { stroke: backslash + slash, fill: "", circle: false };
    case "|":
      return { stroke: bar, fill: "", circle: false };
    case "-":
      return { stroke: dash, fill: "", circle: false };
    case "+":
      return { stroke: bar + dash, fill: "", circle: false };
    case "O":
      return { stroke: "", fill: "", circle: true };
    case "#":
      return { stroke: "", fill: `M${x} ${y}h${e}v${e}h${-e}z`, circle: false };
    default:
      // '.' is the empty cell, and so is anything a future symbol scheme adds
      // that we do not know: drawing a guess would be worse than drawing air.
      return { stroke: "", fill: "", circle: false };
  }
}

/**
 * A grid of Autoglyph characters, drawn as an SVG.
 *
 * White paper is a choice, and the only one available: the contract says
 * nothing about colour, the ink is black, and black on this site's plate is
 * an invisible token. It is stated on the page along with everything else the
 * adapter did.
 */
export function autoglyphSVG(text: string): string {
  const lines = String(text).replace(/\n+$/, "").split("\n");
  const rows = lines.length;
  const cols = lines.reduce((widest, line) => Math.max(widest, line.length), 0);
  const width = AUTOGLYPHS_MARGIN * 2 + cols * AUTOGLYPHS_CELL;
  const height = AUTOGLYPHS_MARGIN * 2 + rows * AUTOGLYPHS_CELL;
  let strokes = "";
  let fills = "";
  let circles = "";
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < lines[row].length; col++) {
      const x = AUTOGLYPHS_MARGIN + col * AUTOGLYPHS_CELL;
      const y = AUTOGLYPHS_MARGIN + row * AUTOGLYPHS_CELL;
      const drawn = autoglyphSymbol(lines[row][col], x, y);
      strokes += drawn.stroke;
      fills += drawn.fill;
      if (drawn.circle) {
        const m = AUTOGLYPHS_CELL / 2;
        circles += `<circle cx="${x + m}" cy="${y + m}" r="${m}"/>`;
      }
    }
  }
  // One path for all the line work rather than 1,780 <line> elements: the same
  // picture, a third of the bytes, and every one of them is cached and shipped
  // to a browser.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}">` +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    (strokes
      ? `<path d="${strokes}" fill="none" stroke="#000" stroke-width="2" stroke-linecap="square"/>`
      : "") +
    (fills ? `<path d="${fills}" fill="#000"/>` : "") +
    (circles
      ? `<g fill="none" stroke="#000" stroke-width="2">${circles}</g>`
      : "") +
    `</svg>`
  );
}

/** The text of an Autoglyph, out of the `data:` URI the contract returns. */
export function autoglyphText(tokenURI: string): string {
  const comma = tokenURI.indexOf(",");
  const payload = comma === -1 ? tokenURI : tokenURI.slice(comma + 1);
  try {
    return decodeURIComponent(payload);
  } catch (err) {
    // The contract encodes its newlines, so this should not happen; if it ever
    // does, the characters themselves are still worth drawing.
    return payload;
  }
}

const AUTOGLYPHS = "0xd4e4078ca3495de5b1d4db434bebc5a986197782";
const DRAW = "0x3b304147"; // draw(uint256)
const SYMBOL_SCHEME = "0x39749064"; // symbolScheme(uint256)

const autoglyphs: Adapter = {
  collection: "Autoglyphs",
  chainId: "1",
  contract: AUTOGLYPHS,
  version: 1,
  reason:
    "Autoglyphs' tokenURI returns the artwork itself, 64 lines of characters " +
    "as text/plain, rather than a metadata document pointing at an image. " +
    "There is no document to read: the token IS the drawing instructions.",
  async read(env: any, tokenID: string): Promise<AdapterResult> {
    const index = BigInt(tokenID);
    // 512 were ever minted, and the contract reverts outside that.
    if (index < 1n || index > 512n) {
      throw new Error(`no such autoglyph: ${tokenID}`);
    }
    const endpoints = getEndpoints(env, "1");
    const [drawing, scheme] = await Promise.all([
      ethCall(endpoints, AUTOGLYPHS, DRAW + uint256(tokenID)).then(decodeString),
      ethCall(endpoints, AUTOGLYPHS, SYMBOL_SCHEME + uint256(tokenID))
        .then((hex) => Number(BigInt(hex)))
        .catch(() => null),
    ]);
    const text = autoglyphText(drawing);

    return {
      metadata: {
        name: `Autoglyph #${tokenID}`,
        description:
          "One of 512 Autoglyphs, generated and stored entirely onchain in " +
          "2019. The contract returns the piece as a grid of characters; the " +
          "drawing here follows the collection's own symbol scheme.",
        image:
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(autoglyphSVG(text)),
        attributes:
          scheme === null
            ? []
            : [{ trait_type: "Symbol Scheme", value: scheme }],
        // No background_color: white belongs to this drawing, which is ours,
        // and claiming it as the token's would be putting words in its mouth.
      },
      note:
        "The characters are drawn the way the collection's own renderer " +
        "draws them: a slash is the cell's diagonal, O its inscribed circle, " +
        "# a filled cell. Black on white, because the contract says nothing " +
        "about colour and black on black is nothing at all.",
      source: {
        address: AUTOGLYPHS,
        method: "draw(uint256) + symbolScheme(uint256)",
      },
    };
  },
};

const CRYPTOKITTIES = "0x06012c8cf97bead5deae237070f9587f8e7a266d";
const GET_KITTY = "0xe98b7f4d"; // getKitty(uint256)

/**
 * Where a kitty's picture lives.
 *
 * NOT a URL we invented: CryptoKitties' own API answers
 * `api.cryptokitties.co/v3/kitties/<id>` with exactly this string in its
 * `image_url` field, so this is the project publishing where its art is kept.
 * We build it rather than fetch it because an adapter that depended on that
 * API being up would produce nothing at all when it is down, where this at
 * least still produces the token's onchain facts.
 *
 * It is also the one thing here that is not onchain, and the page says so.
 */
export function cryptokittyImage(tokenID: string): string {
  return `https://img.cryptokitties.co/${CRYPTOKITTIES}/${tokenID}.svg`;
}

/** One 32-byte word of an ABI-encoded static return, as a bigint. */
function wordAt(hex: string, index: number): bigint {
  const bytes = hexToBytes(hex);
  return bigEndian(bytes.subarray(index * 32, index * 32 + 32));
}

/**
 * The onchain facts about a kitty, from `getKitty`'s ten return values.
 *
 * Deliberately not the "cattributes" everyone knows it by (Mauveover, Ragdoll,
 * and so on): those are computed from the genes by CryptoKitties' own gene
 * science, which is not onchain either, so listing them here would present
 * somebody else's interpretation as the token's own data. Generation and
 * parentage are unarguable; the genes are the token.
 */
export function cryptokittyAttributes(result: string): Metadata["attributes"] {
  const birthTime = wordAt(result, 5);
  const matronId = wordAt(result, 6);
  const sireId = wordAt(result, 7);
  const generation = wordAt(result, 8);
  const attributes: Metadata["attributes"] = [
    { trait_type: "Generation", value: generation.toString() },
  ];
  if (birthTime > 0n) {
    attributes.push({
      trait_type: "Born",
      value: new Date(Number(birthTime) * 1000).toISOString().slice(0, 10),
    });
  }
  // Gen 0 kitties have no parents, and "Matron #0" would be a fact about
  // nothing.
  if (matronId > 0n) {
    attributes.push({ trait_type: "Matron", value: matronId.toString() });
  }
  if (sireId > 0n) {
    attributes.push({ trait_type: "Sire", value: sireId.toString() });
  }
  return attributes;
}

const cryptokitties: Adapter = {
  collection: "CryptoKitties",
  chainId: "1",
  contract: CRYPTOKITTIES,
  version: 1,
  reason:
    "CryptoKitties predates the ERC-721 metadata extension: the contract has " +
    "no tokenURI to call, and it does not claim to (supportsInterface says " +
    "no), so there is no metadata document to read.",
  async read(env: any, tokenID: string): Promise<AdapterResult> {
    const index = BigInt(tokenID);
    if (index < 1n) throw new Error(`no such kitty: ${tokenID}`);
    const endpoints = getEndpoints(env, "1");
    // getKitty reverts past the supply, but answers id 0 with a row of zeroes
    // rather than reverting, so the birth time is what says "this exists".
    const kitty = await ethCall(
      endpoints,
      CRYPTOKITTIES,
      GET_KITTY + uint256(tokenID)
    );
    if (wordAt(kitty, 5) === 0n) throw new Error(`no such kitty: ${tokenID}`);

    return {
      metadata: {
        name: `CryptoKitty #${tokenID}`,
        description:
          "One of the original CryptoKitties, from 2017. The contract stores " +
          "each cat as a 256-bit gene string and its parentage; the drawing " +
          "is rendered from those genes by CryptoKitties itself.",
        image: cryptokittyImage(tokenID),
        attributes: cryptokittyAttributes(kitty),
      },
      note:
        "What the chain stores is a gene string and a family tree, not a " +
        "picture: the drawing is rendered by CryptoKitties and served from " +
        "their image host, which is the address their own API publishes for " +
        "it. Unlike the art on this page that lives in its contract, this " +
        "one goes away if that host does.",
      source: {
        address: CRYPTOKITTIES,
        method: "getKitty(uint256)",
      },
    };
  },
};

export const ADAPTERS: Adapter[] = [cryptopunks, autoglyphs, cryptokitties];

/** The adapter for a contract, if this is one of the exceptions. */
export function findAdapter(chainId: string, contract: string): Adapter | null {
  const wanted = String(contract || "").toLowerCase();
  return (
    ADAPTERS.find(
      (adapter) => adapter.chainId === chainId && adapter.contract === wanted
    ) || null
  );
}
