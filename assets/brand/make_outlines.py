#!/usr/bin/env python3
"""Regenerate outlines.json: the wordmark and tagline converted to paths.

Run this only when the copy or the type spec changes. It needs Inkscape and the
vendored Hack fonts; the normal build (spec.py) does not, which is the point:
the committed SVGs carry no font dependency.

Every string is authored at font-size 100 with its text origin at (0,0), so
spec.py can place it anywhere with one translate+scale.
"""
import json
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
SVG_NS = "{http://www.w3.org/2000/svg}"
PROBE = 100.0
PROBE_X, PROBE_Y = 400.0, 400.0     # keep all ink inside the probe canvas

BOLD = "font-family:'Hack';font-weight:bold"
REGULAR = "font-family:'Hack';font-weight:normal"

# 0.17em pulled out of BOTH sides of the period's monospace cell: without it a
# mono face gives "." a full character width and the wordmark reads as two words.
TIGHTEN = 0.17

def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


STRINGS = {
    # key: (style, markup at font-size 100)
    "wordmark": (BOLD, f'embed<tspan dx="{-TIGHTEN * PROBE:g}">.</tspan>'
                       f'<tspan dx="{-TIGHTEN * PROBE:g}">art</tspan>'),
    "tagline": (REGULAR, "Embed Your Art Anywhere."),
}

# One headline + one explanation per failure state, taken straight from
# spec.py so the copy lives in exactly one place.
from spec import STATE_CARDS  # noqa: E402

for _key, (_head, _sub) in STATE_CARDS.items():
    STRINGS[f"head:{_key}"] = (BOLD, _esc(_head))
    STRINGS[f"sub:{_key}"] = (REGULAR, _esc(_sub))


def _probe_svg(style, markup, tid="t"):
    return (
        "<svg xmlns='http://www.w3.org/2000/svg' width='3000' height='800'>"
        f"<text id='{tid}' x='{PROBE_X:g}' y='{PROBE_Y:g}'"
        f" style=\"{style};font-size:{PROBE:g}px\">{markup}</text></svg>"
    )


def _run(svg, args):
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as fh:
        fh.write(svg)
        src = fh.name
    try:
        return subprocess.run(["inkscape", src] + args,
                              capture_output=True, text=True, check=True)
    finally:
        os.unlink(src)


def ink_box(style, markup):
    out = _run(_probe_svg(style, markup), ["--query-all"]).stdout
    for line in out.splitlines():
        p = line.split(",")
        if p[0] == "t":
            x, y, w, h = (float(v) for v in p[1:5])
            return [x - PROBE_X, y - PROBE_Y, w, h]     # relative to the origin
    raise RuntimeError("no ink box")


def paths(style, markup):
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as fh:
        fh.write(_probe_svg(style, markup))
        src = fh.name
    dst = src.replace(".svg", "-out.svg")
    try:
        subprocess.run(["inkscape", src, "--export-text-to-path",
                        "--export-plain-svg", "-o", dst],
                       capture_output=True, check=True)
        root = ET.parse(dst).getroot()
        ds = [el.get("d") for el in root.iter(f"{SVG_NS}path") if el.get("d")]
    finally:
        for p in (src, dst):
            if os.path.exists(p):
                os.unlink(p)
    if not ds:
        raise RuntimeError("text did not outline; is the font visible to fontconfig?")
    # Path data is left exactly as Inkscape emitted it, in probe coordinates.
    # Rewriting coordinates by hand would risk mangling relative commands and
    # arc flags for no gain: spec.py absorbs the origin into its transform.
    return ds


def build():
    # Cap height is a property of the face, not the string, and every card
    # solves its size against it. Measured once here rather than guessed.
    data = {
        "_caps": {
            "bold": ink_box(BOLD, "EA")[3],
            "regular": ink_box(REGULAR, "EA")[3],
        }
    }
    for key, (style, markup) in STRINGS.items():
        box = ink_box(style, markup)
        ds = paths(style, markup)
        data[key] = {
            "style": style,
            "markup": markup,
            "origin": [PROBE_X, PROBE_Y],
            "ink": box,
            "paths": ds,
        }
    with open(os.path.join(HERE, "outlines.json"), "w") as fh:
        json.dump(data, fh, indent=1, sort_keys=True)
        fh.write("\n")
    for k, v in data.items():
        if k == "_caps":
            print(f"{k:<22} {v}")
            continue
        print(f"{k:<22} ink {['%.2f' % n for n in v['ink']]}  {len(v['paths'])} paths")


if __name__ == "__main__":
    build()
