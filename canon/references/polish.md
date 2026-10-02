# Polish
Load when: a screen works and has been critiqued, and needs finishing or a focused lens pass.

## Goal

Close the gap between competent and finished. The exit condition is a clean detector run, or every remaining finding allow listed with a reason.

## Polish checklist

| Area | Check | Rules |
|---|---|---|
| States | Hover, focus, active, disabled, loading, empty, error, success all exist | `NS-LAYOUT-STATES`, `NS-COPY-EMPTY-STATE` |
| Copy | Specific, plain, consistent. Buttons name actions. Errors say what happened and what to do | `NS-COPY-CTA-VERB`, `NS-COPY-ERROR`, `NS-COPY-FILLER` |
| Motion | One considered moment per the mode, nothing animates layout properties | `NS-MOTION-ONE-MOMENT`, `NS-MOTION-PROPERTIES`, `NS-MOTION-TRANSITION-ALL` |
| Accessibility | Contrast, visible focus, semantics, target size, reduced motion | `NS-A11Y-*` |
| Responsive | No horizontal scroll, readable measure, targets usable by touch | `NS-LAYOUT-RESPONSIVE`, `NS-TYPE-MEASURE` |
| Browser surfaces | Favicon, title, theme colour, selection colour, scrollbars, print, dark theme | `NS-COLOR-THEME-CHOICE`, `NS-COLOR-DARK-PARITY` |
| Detail | Alignment on the spacing scale, consistent icon stroke and size, no raw values | `NS-LAYOUT-SPACING-RHYTHM`, `NS-COLOR-RAW-VALUES` |
| Finish | Layered shadows, concentric radii, balanced headings, tabular figures, gated hover, a pressed state | `NS-FINISH-*`, see `references/finish.md` and `references/interaction.md` |

Fix in the order of the ranked critique, accessibility first.

## Pre flight checklist

Run through this once before declaring a screen finished. Each line is a yes or no.

- The design read and the dials in DESIGN.md still describe what was built.
- One accent, one icon library at one stroke, one corner radius scheme, one theme strategy.
- No pure black or white surfaces, no gradient text, no purple to blue gradient unless the brief asked for it.
- Full height sections use dynamic viewport units (`NS-LAYOUT-VIEWPORT-HEIGHT`).
- Every button label fits on one line, and no two calls to action on a page share the same intent.
- Names, figures and logos are real or clearly sample data (`NS-COPY-PLACEHOLDER-DATA`), and no cliche filler remains (`NS-COPY-FILLER`).
- Both themes were opened and checked (`NS-COLOR-DARK-PARITY`).
- Motion matches the motion dial and has a reduced motion path.
- The page holds at 360px with real content.
- Raised surfaces use layered, tinted shadows, nested corners are concentric, and no border is a pale saturated colour.
- Every button has a pressed state, hover is gated, and figures use tabular numerals.

## Detector loop

1. Run `slop_scan` on the changed files.
2. Fix every error. Use `canon_read` with `rule:<id>` for the reasoning and the suggested fix.
3. Review warnings and fix those that serve the brief.
4. If a finding is right for this project, allow it with a reason: an entry in `northstar.allow`, or an inline `northstar-allow <ID>: <reason>`. Rules marked not allowable cannot be allowed.
5. Rerun until clean.

## Lenses

A lens is a focused pass with one question. Apply a lens only when the critique points to it, and one at a time.

| Lens | Apply when | Move |
|---|---|---|
| bolder | Screen is competent but forgettable | Increase scale contrast, commit to one stronger colour or composition choice, never add more elements |
| quieter | Screen is loud or competing | Remove accents, reduce weights, lower saturation, give space back |
| distill | Too many elements or options | Remove until the primary job is obvious, merge duplicates, cut copy |
| colorize | Palette is flat or arbitrary | Introduce the primary and accent roles with purpose, tint neutrals toward the hue |
| typeset | Hierarchy or readability is weak | Fix scale steps, weights, measure and line height, check `NS-TYPE-SCALE` |
| animate | Interaction feels dead | Add one purposeful transition or the single signature moment, with reduced motion fallback |
| harden | Real data breaks it | Test long text, missing data, errors, slow loads, RTL and zoom |
| onboard | First use is unclear | Improve empty states, first run guidance and the first success path |
| clarify | Labels or flows confuse | Rewrite copy and labels, simplify the steps, name things the way users do |
| finish | The screen works but feels flat, stiff or unfinished | Run the checklist in `references/finish.md`, then the state matrix in `references/interaction.md` |

Lenses never override the brief or the accessibility floor. Bolder in operate mode means more confident, not louder.

## Mode reminders

| Mode | Polish emphasis |
|---|---|
| operate | States, density, keyboard flow, functional motion |
| read | Measure, rhythm, heading structure, print |
| persuade | One signature moment, clear primary action, proof |
| experience | Choreography quality, reduced motion fallback, performance |

## Pitfalls

| Pitfall | Correction |
|---|---|
| Adding decoration to polish | Polish removes noise first |
| Several lenses at once | One lens, then rescan |
| Allowing a rule to silence a scan | Allow only with a real reason, and log it |
| Skipping dark theme or small screens | Check both before declaring done |

## Exit checks

- Detector clean, or each remaining finding allow listed with a reason.
- All states present, copy reviewed, reduced motion path works.
- A short entry appended to `design/decisions.md` for any allow entry.
