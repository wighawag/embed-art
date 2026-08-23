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
