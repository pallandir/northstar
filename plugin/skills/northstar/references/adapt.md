# Adapt
Load when: an existing design must serve a new target such as a platform, breakpoint, theme, density, locale or brand.

## Goal

Extend the existing DESIGN.md for the new target, then compose the changes, without breaking what already works. Adapt is System then Compose.

## Principle

The existing DESIGN.md is the source of truth. A new target adds or overrides tokens, it does not fork the system. If the target needs a different mode, that is a new direction, not an adaptation.

## Targets

| Target | What changes | What stays |
|---|---|---|
| Platform (web, desktop, mobile web, native shell) | Navigation pattern, input assumptions, target sizes | Colour roles, type roles, voice |
| Breakpoint | Layout, density, which content is shown | Tokens, component API |
| Theme (dark, high contrast) | Colour token values per theme | Roles, structure, spacing |
| Density (compact, comfortable) | Spacing scale step, row height, type size by one step | Colour, radii, hierarchy |
| Locale | Text length, direction, number and date formats, fonts for the script | Layout intent, tokens |
| Brand (white label) | Primary, accent, logo, type families | Spacing, states, component structure |

## Procedure

1. Read DESIGN.md and `design/decisions.md`. Run `design_md_validate` to confirm the baseline is clean.
2. State the target and the one thing that must not change. Ask at most 3 questions with defaults, for example the supported breakpoints or the locales in scope.
3. Add the new values as overrides or a new token set, keeping role names identical. Re-run `design_md_validate`.
4. For fonts and icons in the new target, call `resolve_font` and `resolve_icon`. A new script needs a family that covers it.
5. Re-export with `design_md_export` so code picks the new tokens up.
6. Compose the layout and component changes using the existing library components, following `references/compose.md`.
7. Run `slop_scan`, then critique the new target with its own screenshots.

## Rules to watch

| Target | Rules |
|---|---|
| Dark theme | `NS-A11Y-CONTRAST` for every pair again, `NS-COLOR-PURE-BLACK`, `NS-COLOR-GRAY-ON-COLOR` |
| Small breakpoints | `NS-LAYOUT-RESPONSIVE`, `NS-A11Y-TARGET-SIZE`, `NS-TYPE-MEASURE` |
| Density | `NS-LAYOUT-SPACING-RHYTHM`, `NS-A11Y-TARGET-SIZE` |
| Locale | `NS-TYPE-FONT-COUNT`, long text and right to left layout checks in harden |
| Brand | `NS-COLOR-PALETTE-SIZE`, contrast of the new primary on every surface |

Contrast is never inherited. A colour that passes in one theme or brand can fail in another, so validate every pair for every target.

## Do not break

| Risk | Safeguard |
|---|---|
| Renaming tokens | Keep role names, change values only |
| Changing behaviour while restyling | Compose touches presentation, not logic |
| Component forks per target | Use variants and tokens in the same component |
| Silent regressions in the original target | Screenshot the original target before and after |

## Record

Append a decision entry with stage `system`, the target, the tokens added and the rule ids affected. Note any allow entry with its scope, for example a single locale.

## Pitfalls

| Pitfall | Correction |
|---|---|
| Copying DESIGN.md per target | One file, overrides per target |
| Fixing density with scaling | Change the spacing step, keep type readable |
| Testing only in English | Test the longest locale string |
| Treating a new brand as a theme tweak | Check contrast and character of the new primary |

## Exit checks

- Original target unchanged in screenshots.
- New target validated, exported and screenshotted.
- Contrast checked for every pair in the new target.
- Decision recorded.
