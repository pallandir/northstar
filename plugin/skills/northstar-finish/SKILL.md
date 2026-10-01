---
name: northstar-finish
description: Use for the last detail pass on UI that already works, when it feels flat, stiff or unfinished and needs depth, radii, hover and press states, type details and motion tuned before shipping. Smaller than a refine, no audit of the whole product.
license: MIT
metadata:
  version: "3.0.0"
---

# Northstar finish

The final pass between working and shipped. It does not change the structure or the direction. The rules and references live in the `northstar` skill.

## Steps

1. Call `northstar_context` and confirm `DESIGN.md` is valid. Use its tokens and nothing else.
2. Run `slop_scan` with `diff` true to see what the detector says about the changed files.
3. Pull the finish checklist with `canon_read` on `ref:finish`, then the state matrix on `ref:interaction`. Pull `ref:motion` only if motion is in play.
4. Walk each control through default, hover, focus visible, active, disabled, loading, empty and error. Add what is missing.
5. Check depth and shape: layered tinted shadows, concentric radii, borders from the neutral ramp, no pure black or white surfaces.
6. Check type details: balanced headings, tabular figures, real quotes and ellipses, a sensible measure.
7. Check browser surfaces: title, favicon, theme colour, dynamic viewport height, both themes.
8. Rescan until the detector is clean or each finding is allowed with a reason, then record any allow entry in `design/decisions.md`.

## Keep it light

One lens at a time. Do not reload references you already read, and prefer `canon_find` to opening a file.
