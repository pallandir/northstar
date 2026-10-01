# Compose
Load when: DESIGN.md exists and a screen, page or component is about to be planned or built.

## Goal

Turn the brief and system into code in two passes: a plan, then a library first build. Enable the resolve and detect packs.

## Pass 1: the plan

Write the plan before any code. Keep it to one screen of text.

| Part | Content |
|---|---|
| Wireframe | ASCII sketch of regions at desktop and at the narrowest width |
| Hierarchy | What the eye reads first, second, third, and the primary action |
| Bold choice | The single place the design takes a risk: scale, colour, imagery, layout or motion |
| Content | Real headings and copy, or marked placeholders |
| Libraries | The components, icons and fonts that will be used, from DESIGN.md |
| States | Loading, empty, error and success for each data region |

Review the plan against two checks before building:

1. The brief: does it serve the primary job and audience in PRODUCT.md?
2. The default looks: does it resemble the generated defaults, such as `NS-SLOP-CARD-GRID` or `NS-SLOP-HERO-METRIC`? If yes, change the plan, not the code.

One bold choice only. Several competing bold choices read as noise. In operate mode the bold choice may be restraint plus one confident detail.

## Pass 2: the library first build

1. For each need in the plan, call `resolve_library`, `resolve_icon` or `resolve_font`. Pull only the reference sections you need with `canon_find` and `canon_read`, such as `ref:finish` for depth and radii or `ref:interaction` for states.
2. Install what is missing, following `references/libraries.md`.
3. Build with the libraries and with tokens only. No raw colours, no magic spacing (`NS-COLOR-RAW-VALUES`).
4. Run `slop_scan` on the files you wrote and fix errors before moving on.

## Workflow per stack

| Stack | Primitives | Notes |
|---|---|---|
| React or Next.js | shadcn/ui on Radix | Add components through the registry flow, icons from Lucide, fonts through `next/font` or Fontsource |
| Vue | shadcn-vue | Reka UI primitives, Lucide for icons |
| Svelte | shadcn-svelte | Bits UI primitives |
| Angular | Angular CDK | Spartan UI where it fits |
| Solid | Kobalte | Lucide for icons |
| Plain HTML | Native dialog, popover and details | CSS variables from the export |

Overlays, menus, selects, tabs and toasts come from the library, never hand rolled (`NS-LIB-OVERLAY`, `NS-LIB-PRIMITIVE`, `NS-LIB-TOAST`). Icons are never drawn inline or replaced by emoji (`NS-LIB-ICON`, `NS-SLOP-EMOJI-ICON`).

## Real content

Use realistic copy and data from the content inventory. Lorem ipsum hides layout problems and copy problems. Buttons name the action (`NS-COPY-CTA-VERB`). Remove filler (`NS-COPY-FILLER`).

## Responsive

Design from the narrowest width up. Verify at phone, tablet and desktop widths. Horizontal page scroll at any width is a defect (`NS-LAYOUT-RESPONSIVE`, not allowable). Touch targets meet `NS-A11Y-TARGET-SIZE`.

## Structure and semantics

Use real headings, landmarks, buttons and links (`NS-A11Y-SEMANTICS`). Do not nest cards (`NS-SLOP-NESTED-CARD`). Do not centre everything (`NS-LAYOUT-CENTER-EVERYTHING`). Vary scale and emphasis by importance.

## Motion in compose

Motion follows the mode: functional only in operate and read, one signature moment in persuade, choreography in experience. Animate only transform and opacity (`NS-MOTION-PROPERTIES`). Always provide a reduced motion path (`NS-A11Y-REDUCED-MOTION`).

## Pitfalls

| Pitfall | Correction |
|---|---|
| Starting with code | Write the plan first, even a short one |
| Two or three hero treatments | Keep one bold choice |
| Hand writing a dropdown | Resolve it, install it, style it with tokens |
| Hardcoded colours to move faster | Add a token to DESIGN.md first |
| Only designing the happy path | Plan states in pass 1 |

## Exit checks

- The plan was reviewed and any default look removed.
- All components, icons and fonts come from resolved libraries or a logged allow entry.
- `slop_scan` shows no unallowed errors on edited files.
- The screen holds at the narrowest width.
