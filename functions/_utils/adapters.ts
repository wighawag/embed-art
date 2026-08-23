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
 *     token with a working `tokenURI` is never touched.
 *  2. Whatever an adapter produces is disclosed on the page: which contract
 *     was called, which function, and that the document was assembled here
 *     rather than returned by the token. A viewer should never have to guess
 *     where a picture came from.
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
      note:
        "CryptoPunks has no tokenURI, so this document was assembled by " +
        "Embed.Art from the collection's own onchain renderer. A punk is " +
        "transparent and outlined in black; the renderer says nothing about " +
        "what belongs behind it, so neither do we.",
      source: {
        address: CRYPTOPUNKS_RENDERER,
        method: "punkImageSvg(uint16) + punkAttributes(uint16)",
      },
    };
  },
};

export const ADAPTERS: Adapter[] = [cryptopunks];

/** The adapter for a contract, if this is one of the exceptions. */
export function findAdapter(chainId: string, contract: string): Adapter | null {
  const wanted = String(contract || "").toLowerCase();
  return (
    ADAPTERS.find(
      (adapter) => adapter.chainId === chainId && adapter.contract === wanted
    ) || null
  );
}
