---
name: northstar-refine
description: Use when UI already exists and must look cleaner, sleeker and more professional, such as an engineer's first pass, a legacy screen, a pricing page that feels generic, or designer feedback on a built screen. Audits first, then improves one thing at a time. For brand new UI use northstar-build.
license: MIT
metadata:
  version: "3.0.0"
---

# Northstar refine

Elevate what was built without losing behaviour. Engineers build fast and designers refine, and this skill is how the refining stays safe, small and measurable.

## Steps

1. Call `northstar_context`. If `DESIGN.md` is missing, build it from the code first: read the primary colour and fonts, then call `design_tokens_generate` with the closest archetype and `brand` set. Keep the fonts the product ships unless asked.
2. Classify the job: preserve (tidy, same look) or overhaul (new look, same behaviour). Never change routes, navigation labels, form fields, the logo or legal copy without asking.
3. Save screenshots at 1440 and 390 wide. They are the before picture.
4. Call `ui_audit`. It counts colours, radii, shadows, sizes and spacing, shows drift from `DESIGN.md`, runs the detector and orders the levers.
5. Pull one lever per change in the order given: type, colour, states, spacing, depth and shape, motion, then composition. Read only the section for the lever you are on, using `canon_find` and `canon_read` (`ref:refine`, `ref:finish`, `ref:interaction`, `ref:motion`).
6. Change a token or component before an instance. Replace the old values, do not leave both.
7. After each lever run `slop_scan`, take the screenshots again and compare. Check the other theme and keyboard focus.
8. Record what changed and anything the user chose in `design/decisions.md`.

## Comments from the browser

For comments sent by the Northstar extension, use the `resolve-comments` skill. Each comment is one lever.

## Keep it light

Do not load whole references. `references/INDEX.md` in the `northstar` skill is the map, and `canon_find` finds the section.
