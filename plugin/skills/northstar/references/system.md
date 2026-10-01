# System
Load when: DESIGN.md is missing, incomplete, or must be built or normalised from a supplied direction.

## Goal

Produce a valid `DESIGN.md` that holds tokens, prose rationale and the `northstar:` block. Enable the system and resolve packs.

## Route

| Situation | Action |
|---|---|
| Designer supplied freeform markdown | Call `design_md_normalize`, then ask only about missing gates |
| Nothing exists | Call `design_md_init`, or `design_system_propose` from the chosen direction |
| DESIGN.md exists | Call `design_md_validate`, fix findings, extend only what the task needs |

Read `package.json` and `components.json` first so stack and libraries are not asked.

## Tokens

Follow `templates/DESIGN.template.md`. Reference tokens by name, for example `{colors.primary}`, never repeat a raw value.

| Group | Rule |
|---|---|
| Colours | 4 to 6 roles: surface, text, primary, accent, plus optional muted and danger. Derive neutrals from the palette hue (`NS-COLOR-PALETTE-SIZE`, `NS-COLOR-PURE-BLACK`) |
| Typography | Roles, not sizes: display, heading, body, label, code. One or two families (`NS-TYPE-FONT-COUNT`) |
| Spacing | One base unit and a short scale, used for rhythm (`NS-LAYOUT-SPACING-RHYTHM`) |
| Radii | Two or three values, one shape language |
| Elevation | Two or three soft layered shadows, no hard offsets (`NS-SLOP-HARD-SHADOW`) |
| Motion | Duration tokens, one easing curve defined once (`NS-MOTION-EASING`), a budget set by the mode |

Display size is capped by mode (`NS-TYPE-DISPLAY-MAX`). An Experience exception needs an allow entry.

## Libraries

Fill `northstar.libraries` with components, icons and fonts. Do not guess: call `resolve_library` for components, `resolve_icon` for the icon set and `resolve_font` for the faces, giving the subject and mood. Details are in `references/libraries.md`.

## Component states

For each component the project uses, list the states that must exist: default, hover, focus, active, disabled, loading, error, empty where relevant. Missing states are caught by `NS-LAYOUT-STATES`. Focus must be visible (`NS-A11Y-FOCUS-VISIBLE`).

## Contrast pairs

Declare text and surface pairs in the components section so validation can check them. Body text needs 4.5 to 1 and large text 3 to 1 (`NS-A11Y-CONTRAST`). This rule cannot be allowed away. Check light and dark themes separately when both exist.

## The northstar block

| Key | Content |
|---|---|
| `mode` | operate, read, persuade or experience |
| `stack` | Detected framework |
| `libraries` | components, icons, fonts |
| `allow` | List of rule, reason, scope. Empty by default |
| `ignore` | Globs the detector skips, such as generated code |

An allow entry needs a reason that a reviewer could judge. Log it in `design/decisions.md`.

## Validate and export

1. Run `design_md_validate`. Fix broken references, missing roles and failing contrast pairs.
2. Call `design_md_export` for the project's target: Tailwind theme, CSS variables or DTCG tokens.
3. Wire the export into the build so code uses tokens only (`NS-COLOR-RAW-VALUES`).

| Target | Choose when |
|---|---|
| Tailwind | The project uses Tailwind |
| CSS variables | Plain CSS, CSS modules, or any framework without a theme layer |
| DTCG | Tokens feed Figma or a multi platform pipeline |

## Pitfalls

| Pitfall | Correction |
|---|---|
| Eight or more colours with no roles | Collapse to roles, name each by purpose |
| Hex values repeated in prose | Reference tokens |
| Choosing a font from memory | Use `resolve_font` |
| Prose that describes only the look | Add why: mood, audience, constraints |
| Silent allow entries | Reason required, and log it |

## Exit checks

- `design_md_validate` passes.
- Mode, stack and libraries are set.
- Export generated and imported by the app.
- Decision entries appended for anything the user chose.
