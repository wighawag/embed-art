/**
 * What goes behind art that does not bring its own background.
 *
 * The card is a JPEG, so whatever the art does not cover has to be some
 * colour, and the choice is not ours to make by taste. Three rules, in order:
 *
 *  1. If the metadata declares `background_color`, use it. That field is the
 *     token saying what it wants, and it is the only authority here.
 *  2. Otherwise the site's plate. Mandalas are drawn for a dark backdrop and
 *     say nothing about it, and a dark backdrop is what they get.
 *  3. A viewer may override with `?bg=`, for their own eyes only.
 *
 * An earlier version sampled the art and switched to a light backdrop when it
 * found dark strokes on transparency. That is guessing, and it guessed wrong
 * about art whose author chose black on purpose. What survives of it is
 * hidesDarkStrokes(), which changes nothing and only lets the page SAY that
 * part of the art cannot be seen against the backdrop it was given: a
 * CryptoPunk's outline is `#000000` on transparency, and a token that declares
 * no background_color has left that decision to whoever displays it.
 *
 * NOTE: injected verbatim into both page templates. Self-contained, no
 * imports, no module-scope references.
 */

export type BackdropStats = {
  /** share of sampled pixels that are opaque */
  opaqueRatio: number;
  /** share of the BORDER that is opaque: art with its own background is ~1 */
  edgeOpaqueRatio: number;
  /** share of opaque pixels that are near-black */
  darkShare: number;
};

/** A CSS colour from the token's own `background_color`, or null. */
export function backgroundColorOf(metadata: any): string | null {
  var declared = metadata && metadata.background_color;
  if (typeof declared !== "string") return null;
  var hex = declared.replace(/^#/, "").trim();
  // The convention (OpenSea's, and everyone's since) is six hex digits with
  // no '#'. Three and eight are accepted because they also mean something.
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) return null;
  return "#" + hex;
}

/** Reads a sample of the art. Pure, so the judgement can be tested. */
export function backdropStats(
  pixels: Uint8ClampedArray | number[],
  size: number
): BackdropStats {
  var opaque = 0;
  var dark = 0;
  var edge = 0;
  var edgeOpaque = 0;
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var i = (y * size + x) * 4;
      var alpha = pixels[i + 3];
      var isEdge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      if (isEdge) {
        edge++;
        if (alpha > 24) edgeOpaque++;
      }
      if (alpha <= 24) continue;
      opaque++;
      // Rec. 709 luma, the same weighting a display uses.
      var luma =
        (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) /
        255;
      if (luma < 0.05) dark++;
    }
  }
  var total = size * size;
  return {
    opaqueRatio: total ? opaque / total : 0,
    edgeOpaqueRatio: edge ? edgeOpaque / edge : 0,
    darkShare: opaque ? dark / opaque : 0,
  };
}

/**
 * Would part of this art be invisible against a near-black backdrop? True only
 * when the art floats (no background of its own) and draws in near-black.
 * Used to inform, never to override.
 */
export function hidesDarkStrokes(stats: BackdropStats | null): boolean {
  if (!stats || stats.opaqueRatio === 0) return false;
  if (stats.edgeOpaqueRatio > 0.75) return false;
  return stats.darkShare > 0.02;
}

/** Sample a loaded image. Returns null if the pixels cannot be read. */
export function sampleArt(image: any): BackdropStats | null {
  try {
    var size = 24;
    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    var context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.clearRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    return backdropStats(context.getImageData(0, 0, size, size).data, size);
  } catch (err) {
    // A tainted canvas, an image that never decoded: say nothing.
    return null;
  }
}

/** A colour a viewer asked for in `?bg=`, or null. */
export function requestedBackdrop(search: string): string | null {
  var match = /[?&]bg=([^&]+)/.exec(String(search || ""));
  if (!match) return null;
  var value = decodeURIComponent(match[1]).replace(/^#/, "").trim();
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return null;
  }
  return "#" + value;
}
