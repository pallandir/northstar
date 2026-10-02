# Refine
Load when: a UI already exists, an engineer built it and it needs to look cleaner, sleeker and more professional without losing behaviour, or a designer is improving a screen or resolving browser comments.

## Goal

Turn what exists into something polished with small, reviewable changes. Engineers build fast, designers refine what was built. Refine keeps both honest: it starts from numbers, changes one thing at a time and proves each change with a screenshot and a scan.

## Gate and scope

- `DESIGN.md` comes first. If it does not exist, build it from the code (see Bring it under a system below) before touching a style.
- Classify the job. Preserve means keep the look and tidy it, so match the current values. Overhaul means a new look on the same behaviour, so the dials rise and the archetype changes.
- Never change these silently: route paths, primary navigation labels, form field names and order, the logo or wordmark, and legal or consent copy. Ask first.
- Keep the stack. Do not migrate a framework or a styling system to refine a screen. Express every fix in what the project already uses.

## Inventory first

Call `slop_scan` with `inventory` true on the screens in scope. It returns the distinct colours, radii, shadows, font sizes, spacing values, z indexes and durations, the drift from DESIGN.md, the detector findings and the order of levers. Read it as a diagnosis: 23 greys and 7 radii mean the system is missing, not that the colours are wrong.

Open the running UI at 1440 and 390 wide and save the screenshots. They are the before picture, and no refine pass is judged without them.

## Levers in order

Pull one lever per change. The order matters because each lever stabilises the next.

| Lever | What changes | Done when |
|---|---|---|
| type | Faces, scale, weights, tracking, measure, balanced headings, tabular figures | One scale, one or two families, `NS-TYPE-*` clean |
| colour | Neutrals tinted toward the brand, one accent, status colours, borders from the ramp, both themes | Palette is roles, contrast passes, `NS-COLOR-*` and `NS-LOOK-*` clean |
| states | Hover, focus visible, active, disabled, loading, empty, error | Every control has the full matrix (`references/interaction.md`) |
| spacing | One spacing scale, aligned rows and edges, a steady rhythm | Few distinct spacing values and no stray margins |
| depth and shape | Layered shadows, concentric radii, surface steps | Tokens only (`references/finish.md`) |
| motion | Duration and easing tokens, press feedback, reduced motion | `NS-MOTION-*` clean and nothing animates a layout property |
| composition | Hierarchy, scale contrast, grouping, structure | Last resort, because it changes the layout |

## Make it a system, not a patch

- Change a token before you change an instance. If ten buttons are wrong, the button component or the token is wrong.
- Map existing values to the nearest token and replace them in one pass, then delete the old values. Do not leave both.
- Where the existing palette is a Tailwind default, derive a tinted ramp from the brand colour with `design_tokens_generate` and keep the brand hue.

## Bring it under a system

When no DESIGN.md exists, read the primary colour, fonts and radius from the code. Call `design_tokens_generate` with the closest archetype and the brand colour as `brand`, let the generator fill the neutrals, shadows and motion, and keep the fonts the product already ships unless the brief says otherwise. Validate it, then migrate screen by screen.

## Verify every change

1. Rescan the files with `slop_scan` and check that findings went down, not sideways.
2. Take the 1440 and 390 screenshots again and compare them with the before pair.
3. Check the other theme, keyboard focus and one error or empty state.
4. Append a line to `design/decisions.md` for anything the user chose.

## Browser comments

A comment from the extension is a refine task of one lever. Resolve it at the token or component level when the same fault repeats, scan the edited files and record what changed. The procedure is in `references/comments.md`.

## Pitfalls

| Pitfall | Correction |
|---|---|
| Several levers in one diff | One lever, then rescan |
| Polishing before a system exists | Inventory, then tokens, then instances |
| Adding decoration to look refined | Refine removes noise first |
| Changing copy, routes or labels | Ask first, keep behaviour |
| Judging from code alone | Look at the screenshots |

## Exit checks

- Inventory counts moved toward one scale per category.
- Detector clean, or each remaining finding allowed with a reason.
- Before and after screenshots at both widths, both themes checked.
- Behaviour, routes and copy unchanged unless the user asked.
