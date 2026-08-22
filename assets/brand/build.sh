#!/usr/bin/env bash
#
# Regenerate every derived brand asset from assets/brand/spec.py.
#
#   ./build.sh            rasterise the committed SVGs into public/
#   ./build.sh --check    fail if anything has drifted, render nothing
#
# The SVGs themselves are emitted by `python3 spec.py`. This script refuses to
# render until the committed SVGs match what spec.py would emit, so a hand edit
# to a generated file is caught here instead of shipping.
#
# No font is needed: the wordmark and tagline are already outlines in
# outlines.json. Re-run `python3 make_outlines.py` (needs Inkscape + the
# vendored Hack) only when the copy or the type spec changes.
set -euo pipefail
cd "$(dirname "$0")"

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

PUB="../../public"
STATIC="$PUB/static"

# --- rasteriser probe: ImageMagick will silently render SVG through its own
# --- weak delegate, so confirm the tool we actually want is present.
command -v inkscape >/dev/null || { echo "error: inkscape not found" >&2; exit 1; }
command -v magick   >/dev/null || { echo "error: imagemagick not found" >&2; exit 1; }
echo "rasteriser: $(inkscape --version 2>/dev/null | head -1)"

# --- drift check -------------------------------------------------------------
python3 spec.py --check

# --- helpers -----------------------------------------------------------------
# Always render at 2x and downsample: the mark is hard-edged geometry and
# stairsteps visibly when rasterised straight to size.
png() { # svg out width [height]
  local h="${4:-$3}"
  inkscape "$1" -o "$TMPD/raw.png" -w "$(( $3 * 2 ))" -h "$(( h * 2 ))" >/dev/null 2>&1
  magick "$TMPD/raw.png" -resize "${3}x${h}" -strip "$2"
}

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

OUTDIR="$PUB"
if [ "$CHECK" = 1 ]; then
  OUTDIR="$TMPD/out"
  mkdir -p "$OUTDIR/static"
fi

mkdir -p "$OUTDIR/static"

# --- vector, served as-is ------------------------------------------------------
cp icon.svg          "$OUTDIR/static/icon.svg"
cp wordmark-dark.svg "$OUTDIR/static/wordmark.svg"

# --- the card ----------------------------------------------------------------
png preview.svg "$OUTDIR/static/preview.png" 1280 640

# --- failure-state cards -------------------------------------------------------
# A link that unfurls to an error should still unfurl as Embed.Art, not borrow
# the front page's card and imply everything worked. Names match what the
# handlers request: /static/<state>.png
for svg in state-*.svg; do
  state="${svg#state-}"; state="${state%.svg}"
  png "$svg" "$OUTDIR/static/$state.png" 1280 640
done

# --- icons -------------------------------------------------------------------
png icon.svg "$OUTDIR/static/icon-512.png" 512
png icon.svg "$OUTDIR/static/icon-192.png" 192
png icon.svg "$OUTDIR/apple-touch-icon.png" 180
png icon.svg "$TMPD/f16.png" 16
png icon.svg "$TMPD/f32.png" 32
png icon.svg "$TMPD/f48.png" 48
cp "$TMPD/f16.png" "$OUTDIR/static/favicon-16.png"
cp "$TMPD/f32.png" "$OUTDIR/static/favicon-32.png"
magick "$TMPD/f16.png" "$TMPD/f32.png" "$TMPD/f48.png" -strip "$OUTDIR/favicon.ico"

# --- maskable ----------------------------------------------------------------
# Fed from icon-bare.svg (no plate) so the result is not a box inside a box,
# and the plate colour is the icon's own, so there is no banded edge.
maskable() { # size out
  inkscape icon-bare.svg -o "$TMPD/bare.png" -w "$(( $1 * 2 ))" -h "$(( $1 * 2 ))" >/dev/null 2>&1
  # 0.60 of the canvas: a square mark's DIAGONAL must fit the 80% safe circle,
  # so the side cannot exceed 0.8/sqrt(2) = 0.566 of the canvas plus a little
  # optical slack. Verified with the circle overlay, see README.
  local inner=$(( $1 * 2 * 60 / 100 ))
  magick -size "$(( $1 * 2 ))x$(( $1 * 2 ))" "xc:#111111" \
    \( "$TMPD/bare.png" -resize "${inner}x${inner}" \) -gravity center -composite \
    -resize "${1}x${1}" -strip "$2"
}
maskable 512 "$OUTDIR/static/icon-maskable-512.png"
maskable 192 "$OUTDIR/static/icon-maskable-192.png"

# --- verify ------------------------------------------------------------------
if [ "$CHECK" = 1 ]; then
  fail=0
  while IFS= read -r f; do
    rel="${f#$OUTDIR/}"
    if ! cmp -s "$f" "$PUB/$rel"; then
      echo "error: $rel differs from a fresh render" >&2
      fail=1
    fi
  done < <(find "$OUTDIR" -type f)
  [ "$fail" = 0 ] && echo "ok: committed rasters match a fresh render"
  exit "$fail"
fi

echo "wrote:"
echo "  public/static/preview.png              1280x640 card (og:image)"
echo "  public/static/icon.svg  wordmark.svg"
echo "  public/static/icon-512.png  icon-192.png"
echo "  public/static/favicon-16.png favicon-32.png"
echo "  public/static/icon-maskable-{192,512}.png"
echo "  public/static/{error-*,ens-*}.png        branded failure cards"
echo "  public/favicon.ico  public/apple-touch-icon.png"
