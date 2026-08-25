/**
 * Courtesies extended to metadata that does not follow the standard.
 *
 * The token page fetches and renders the way a browser does, on purpose. Some
 * tokens cannot survive that, not because the art is gone but because the
 * document describing it breaks the rules it claims to follow:
 *
 *  - a `data:` URI whose payload was never percent-encoded, so the first `#`
 *    in it (an SVG fill colour, usually) ends the URL and a browser receives a
 *    truncated fragment of the JSON. the_coin #36 delivers 791 bytes of 14,137
 *    this way.
 *  - the same breach one level down: an `image` (or `animation_url`) that IS a
 *    `data:` URI, unencoded, so the browser cuts the artwork itself at the
 *    first `#` in a fill colour. [sol]Seedlings writes its whole SVG that way.
 *  - an `image` holding the SVG document itself rather than a URI to one. The
 *    ERC-721 schema says "a URI pointing to a resource with mime type image/*";
 *    markup in that field can never load in an <img>.
 *
 * Neither is our mistake to make, and neither is the owner's to suffer, so we
 * render them anyway and say what was wrong. The repairs are strictly
 * client-side because the preview IS this page, screenshotted: a fix that
 * lived on the server would produce a card the visitor's own browser could not
 * reproduce.
 *
 * Every repair is reversible with `?strict`, which turns the courtesies off
 * and shows exactly what a compliant client sees. That is the honest default
 * for anyone judging a token, and it is how these two cases were diagnosed.
 *
 * NOTE: each function here is injected verbatim into both page templates, so
 * they must stay self-contained: no imports, no module-scope references.
 */

/** Is the courtesy layer on? `?strict` (or `?strict=1`) turns it off. */
export function courtesyEnabled(search: string): boolean {
  return String(search || "").indexOf("strict") === -1;
}

/**
 * The payload of a `data:` URI, read from the STRING rather than by fetching
 * it as a URL.
 *
 * This is the whole difference for a malformed one: `fetch()` applies URL
 * rules, so an unencoded `#` truncates the document, while reading the string
 * keeps every byte the contract returned. Returns null for anything that is
 * not a data URI, so the caller can fall back to fetching properly.
 */
export function dataURIPayload(uri: string): string | null {
  if (typeof uri !== "string" || uri.slice(0, 5).toLowerCase() !== "data:") {
    return null;
  }
  var comma = uri.indexOf(",");
  if (comma === -1) return null;
  var meta = uri.slice(5, comma).toLowerCase();
  var payload = uri.slice(comma + 1);
  if (meta.indexOf(";base64") !== -1) {
    try {
      var binary = atob(payload);
      // atob yields bytes; the JSON may be UTF-8, so decode it as such.
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch (err) {
      return null;
    }
  }
  try {
    return decodeURIComponent(payload);
  } catch (err) {
    // Not percent-encoded at all, which is itself the breach: use it raw.
    return payload;
  }
}

/**
 * The kind of markup a value IS, when it should have been a URI to one.
 * Returns "svg", "html", or null when the value looks like a URI.
 */
export function markupKind(value: string): string | null {
  if (typeof value !== "string") return null;
  var trimmed = value.replace(/^[\s\ufeff]+/, "");
  if (trimmed.charAt(0) !== "<") return null;
  var head = trimmed.slice(0, 400).toLowerCase();
  if (head.indexOf("<svg") !== -1) return "svg";
  if (head.indexOf("<!doctype html") !== -1 || head.indexOf("<html") !== -1) {
    return "html";
  }
  // An `<?xml` declaration on its own says nothing; look at what follows.
  return null;
}

/** That same markup, wrapped so a browser can actually load it. */
export function markupToDataURI(value: string, kind: string): string {
  var type = kind === "html" ? "text/html" : "image/svg+xml";
  return "data:" + type + ";charset=utf-8," + encodeURIComponent(value);
}

/**
 * A `data:` media URI a browser can actually load, or null when the one given
 * is already fine.
 *
 * This is `dataURIPayload`'s breach one level down. There, an unencoded
 * `data:` tokenURI is *read* rather than fetched, which recovers the document.
 * That does nothing for a document whose `image` is itself an unencoded
 * `data:` URI: the string is intact, but the moment it is put in an `<img>`
 * (or a CSS `url()`) the URL parser reads the first `#` as a fragment and the
 * artwork ends there. [sol]Seedlings #460 is 3.9KB of onchain SVG that stops
 * at `stroke='` for exactly this reason, and the leading `#` of a fill colour
 * is the single most likely character to appear in an SVG.
 *
 * The bytes are right and the envelope is not, so the envelope is rewritten:
 * the media type is kept, the payload is percent-encoded as RFC 2397 requires,
 * and the charset is stated (`;utf8`, which these contracts write, is not a
 * parameter RFC 2397 defines). Anything already encoded, base64, or free of
 * `#` is left alone: returning null keeps "nothing was wrong" distinguishable
 * from "repaired", which is what the page reports and `?strict` withdraws.
 *
 * THE ROUND TRIP MUST BE EXACT, and this is the trap. A media URI inside a
 * `data:` document is read as a URL TWICE: once when the page fetches the
 * document, and once when the `<img>` fetches the artwork out of it. Bleeps
 * writes `%2520` for that reason, so that two decodes land on the space it
 * meant, and it is CORRECT. Decoding once and re-encoding once preserves that
 * (`%2520` -> `%20` -> `%2520`); decoding twice, or encoding the raw payload
 * without decoding, would eat a pass and deliver `%20` into the SVG. A token
 * that was right before we touched it must be right after.
 */
export function encodedDataURI(value: string): string | null {
  if (typeof value !== "string" || value.slice(0, 5).toLowerCase() !== "data:") {
    return null;
  }
  var comma = value.indexOf(",");
  if (comma === -1) return null;
  var meta = value.slice(5, comma);
  var payload = value.slice(comma + 1);
  // base64 has no '#' to lose, and re-encoding one would corrupt it.
  if (meta.toLowerCase().indexOf(";base64") !== -1) return null;
  // '#' is the only character a URL parser truncates on; everything else it
  // tolerates, and a URI we rewrite for no reason is a URI we broke for no
  // reason.
  if (payload.indexOf("#") === -1) return null;
  var decoded = payload;
  try {
    // A payload that IS percent-encoded and still carries a bare '#' must be
    // decoded first, or the escapes it already has would be encoded twice.
    decoded = decodeURIComponent(payload);
  } catch (err) {
    // Not percent-encoded at all, which is the usual case here: use it raw.
  }
  var type = meta.split(";")[0] || "text/plain";
  return "data:" + type + ";charset=utf-8," + encodeURIComponent(decoded);
}
