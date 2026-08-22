# Embed.Art brand assets

## The mark in two sentences

Two brackets hold a solid gold square: a slot belonging to somebody else, with your art placed in it. The brackets are the host frame (a feed, a timeline, a card that Twitter or Facebook owns), the gold is the only thing that ever wears the accent, and it is the art that Embed.Art got through.

## Authored vs generated

Nothing in the generated column should ever be edited by hand. `build.sh` refuses to run if one of them has been.

| File | Kind | Produced by |
| --- | --- | --- |
| `spec.py` | authored | the single source of truth: geometry, palette, layout |
| `make_outlines.py` | authored | regenerates `outlines.json` |
| `fonts/hack/*` | authored | vendored Hack, MIT, with its `LICENSE.md` |
| `outlines.json` | generated | `python3 make_outlines.py` (needs Inkscape + the vendored font) |
| `logo.svg` | generated | `python3 spec.py` |
| `wordmark.svg`, `wordmark-dark.svg` | generated | `python3 spec.py` |
| `icon.svg`, `icon-bare.svg` | generated | `python3 spec.py` |
| `preview.svg` | generated | `python3 spec.py` |
| `../../public/static/preview.png` | generated | `./build.sh` |
| `../../public/static/{error,ens}-*.png` | generated | `./build.sh` |
| `../../public/static/icon{,-192,-512}.{svg,png}` | generated | `./build.sh` |
| `../../public/static/icon-maskable-{192,512}.png` | generated | `./build.sh` |
| `../../public/static/favicon-{16,32}.png`, `wordmark.svg` | generated | `./build.sh` |
| `../../public/favicon.ico`, `apple-touch-icon.png` | generated | `./build.sh` |

```sh
python3 spec.py        # re-emit the SVGs after changing spec.py
./build.sh             # rasterise into public/
./build.sh --check     # fail if anything drifted; renders nothing
python3 make_outlines.py   # only when the copy or the type spec changes
```

## Easy to fix by mistake

Each of these looks like a mistake and is not.

- **The gold is opaque, never translucent.** A translucent accent goes brown over the dark plate and washes out on white. Solid renders identically on both.
- **Exactly one thing wears the accent.** The gold square is the art. The period in `embed.art` was tried in gold and rejected: it puts a second idea in the accent for no semantic gain.
- **`icon.svg` is not `logo.svg` scaled.** The icon uses a heavier stroke (34 vs 28) and a wider opening, because at 16px the logo's 28-unit stroke falls under two device pixels and the brackets disappear. Scaling the logo down instead produces a gold dot with two grey smudges.
- **`icon.svg` carries an opaque plate.** A transparent icon with light ink vanishes on a light browser tab. `icon-bare.svg` is the plate-free cut, and it exists solely to feed the maskable generator, so the result is not a box inside a box.
- **The maskable inner size is 0.60 of the canvas, not 0.88.** The safe zone is a circle at 80% of the canvas, and this mark is square, so its *diagonal* is the binding constraint: 0.8 / sqrt(2) = 0.566, plus slack. Verify rather than trust:
  ```sh
  magick ../../public/static/icon-maskable-512.png -fill none -stroke red \
    -strokewidth 4 -draw "circle 256,256 256,51" /tmp/check.png
  ```
- **The wordmark's period is manually tightened by 0.17em on each side.** Hack is monospace, so it gives `.` a full character cell and the wordmark reads as two words, `embed . art`. The value is in `make_outlines.py:TIGHTEN` and is baked into the outlines; changing it means re-running `make_outlines.py`.
- **The card has no motif texture.** The stack fills the card, so faint marks in the corners had to be cropped by the edge, which read as rendering glitches rather than texture. The radial glow carries the depth alone.
- **The card reuses the approved lockup's proportions.** An earlier draft followed a generic grid and ended up with a mark-to-wordmark ratio of 2.98 against the approved 1.4. If you change `CARD_LOCKUP_W`, the ratio stays fixed because both parts scale together; do not scale them separately.
- **Failure states get their own cards.** `STATE_CARDS` in `spec.py` produces a branded 1280x640 card per failure (`error-notfound`, `ens-no-avatar`, and so on). Without them a link that unfurls to an error borrows the front page's card and tells the reader everything is fine. The copy lives in `spec.py` only; `make_outlines.py` imports it, so headline text cannot drift between the card and the outline set.
- **On a failure card the brand is deliberately small and top-left.** The subject of that card is the failure, so the icon leads and the lockup sits in a letterhead position. A first attempt put the lockup across the top at full size and it read as an advert with an error attached. The same letterhead is repeated on the HTML error and ENS pages so the three agree.
- **The card icons are mirrored in `functions/_handlers/errorPage.ts`.** Two copies of the same 24x24 paths, one for the raster card and one for the HTML page. Change one, change the other; there is no check that will catch it.
- **Card headlines are sized by two constraints, not one.** Cap height alone runs the longest headline ("Blockchain Data Unavailable") off a 1280px card, so the scale is `min(cap-height fit, width fit)`. Shortening a headline will make it bigger; that is intended.
- **`wordmark-dark.svg` duplicates `wordmark.svg`.** An `<img>` tag and a GitHub README cannot pass `currentColor` into an SVG, so the dark-ink cut must exist as a real file. Both come from one function, so they cannot diverge.

## Solved type values

Wordmark: `embed.art`, Hack Bold, period tightened 0.17em each side.
Tagline: `Embed Your Art Anywhere.`, Hack Regular.

The construction rule, which is how any future size is re-derived: **the wordmark's ink box height equals the bracket's inner opening (140 units of the mark's 196-unit ink box)**, so the word is exactly as tall as the slot. The gap between mark ink box and wordmark ink box is 56 units. Measured, not guessed:

| Quantity | Value |
| --- | --- |
| Hack Bold cap height at 100px | 72.90 |
| Hack Bold x-height at 100px | 57.42 |
| `embed.art` ink box at 100px, tightened | 496.03 x 78.03 |
| `Embed Your Art Anywhere.` ink at 100px | 1412.94 x 96.78 |
| Lockup, mark ink 196 | font-size 179.424, ink 890.00 x 140.00 |

These are not magic numbers to copy: `outlines.json` records the ink box of each string at font-size 100, and `spec.py` derives every placement from it, so changing the copy and re-running `make_outlines.py` re-solves all of them. To measure a candidate directly:

```sh
printf '%s' "<svg xmlns='http://www.w3.org/2000/svg' width='2000' height='400'><text id='t' x='40' y='300' style=\"font-family:'Hack';font-weight:bold;font-size:100px\">embed.art</text></svg>" > /tmp/t.svg
inkscape /tmp/t.svg --query-all      # id,x,y,width,height
```

Measure, never trust a nominal point size: it is not comparable across faces. And verify a weight actually *resolved* by comparing rendered ink (`magick out.png -alpha extract -format '%[fx:mean]' info:`) rather than by reading the family name back, because a missing cut falls back silently. During this work `'JetBrains Mono ExtraBold'` as a family name reported *less* ink than regular, which is what a silent fallback looks like.

**Font licence.** Hack is MIT (see `fonts/hack/LICENSE.md`), which permits both redistribution and converting glyphs to outlines. The outlines in `outlines.json` are a derivative of it, and the licence travels with this directory.

## Palette

| Role | Hex | Note |
| --- | --- | --- |
| Accent | `#BE8F04` | the art in the slot; exactly one thing wears it |
| Ink, dark surfaces | `#F5DEB3` | wheat, as the site already used |
| Ink, light surfaces | `#1A1A1A` | the `currentColor` default in every SVG |
| Plate | `#111111` | the site background |
| Muted | `#8E826A` | tagline only; wheat at ~55% over the plate |

## Directions tried and dropped

Six rounds of contact sheets were produced and deliberately not kept; this list is the record. Nothing below should be re-proposed without a reason that answers the failure noted against it.

- **Aperture** (formats in, flat card out through a slot): the circle and curve read as a face; three unrelated specks at 32px.
- **Unfurl** (a card with its corner folded back): survived 16px better than anything else, but read as a file/document icon, and made the gold a corner ornament rather than the subject.
- **Overflow** (a frame with a gold sweep escaping it): best at 256, but the frame's stroke vanished by 16px leaving a rect with a diagonal, i.e. the broken-image placeholder, and the rising diagonal read as a growth chart.
- **Unroll** (a coil paying out a gold band): read as a frying pan.
- **Echo** (one artwork inside three different host silhouettes): needs three objects, so it is a smudge in an icon; the gold arcs read as smiles.
- **Nested / drop-in / peeled** (two overlapping cards, a card entering a slot, a card revealed under a fold): respectively the copy-duplicate icon, a SIM card, and "weird".
- **Tag** `<art>`: the best-looking of all of them, but it is `</>` minus the slash, so it reads developer-tool, and at 16px the chevrons close into a diamond, which is the ETH lozenge.
- **Breakout** (the guest too wide for the brackets): carried the brief best of any variant, but in square-cornered bracket language the overrun splits each bracket into detached fragments and they stop reading as brackets.

## Known gaps and accepted trades

- **The mark is simple enough to be mistaken for a UI glyph.** `[` plus a filled square plus `]` could read as a selection or placeholder control out of context. Accepted knowingly: it is true to the product, it survives 16px, and it nearly always appears with the wordmark and the gold.
- **At 16px the bracket arms are effectively gone**, leaving two vertical bars around the gold square. The slot reading survives; the bracket reading does not. This is why the icon cut is drawn separately rather than scaled.
- **The tagline is monospace and therefore loose.** Consistent with the site, but it is the weakest element on the card. A proportional companion face would fix it and would also break the single-family discipline; not worth it yet.
- **No light-background card.** `preview.png` is dark only. Add `preview-light.png` and a `<picture>` in the README if it is ever needed.
- **The icon set is generated by `build.sh`, not by a dedicated tool.** `pwag` was not available here. If the app grows real PWA ambitions, regenerate the set with a proper tool and delete the hand-rolled branch in `build.sh`.
- **The previous card was a hand-made GIMP file** (`assets/preview.xcf`, deleted with this change) that nothing could rebuild. If you need the old wheat-serif card, it is in git history before this commit.
