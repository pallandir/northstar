# Critique
Load when: a screen has been built or changed and needs an honest evaluation before polish.

## Goal

Judge the work against its own purpose, rank what to fix and record the result.

## The loop

1. Capture screenshots of the real screen at desktop and phone widths, in the default theme and in the other theme if one exists. Include one loaded state and one empty or error state.
2. Look before reading code. Write down the first impression in one sentence, and what the eye reads first.
3. Call `critique_rubric` to get the dimensions and the weights for the current mode.
4. Score each dimension from 0 to 10, with one line of evidence each.
5. Run `slop_scan` on the changed files, and `slop_scan` with `inventory` true when the screen was refined from existing code. Use `canon_read` with `rule:<id>` for any id you do not recognise.
6. Apply the gates, rank the findings, and record.

## Rubric

The rubric lives in `rubric.yaml`. Dimensions: hierarchy, typography, color, composition, motion, craft, finish, copy, accessibility. Finish asks whether depth, radii, borders, type details and interaction feel resolved, using `references/finish.md` as the yardstick. Weights change per mode, so an operate screen is judged mostly on hierarchy and craft, an experience screen on typography, composition and motion.

Score against the page's own purpose, not an abstract ideal. A calm tool is not marked down for lacking spectacle.

| Band | Meaning |
|---|---|
| 9 and above | Distinctive and finished |
| 7 to 8 | Solid, minor polish left |
| 5 to 6 | Competent but generic |
| Below 5 | Needs rework |

## Gates

| Gate | Effect |
|---|---|
| Any `NS-A11Y` error | Overall score capped at 6 |
| Any unallowed detector error | Overall score capped at 7 |

Apply the caps after weighting. A beautiful screen with failing contrast is still capped.

## Ranking findings

Order findings by impact on the primary job, not by how easy they are to fix.

| Rank | Kind | Examples |
|---|---|---|
| 1 | Accessibility floor | `NS-A11Y-CONTRAST`, `NS-A11Y-FOCUS-VISIBLE`, `NS-LAYOUT-RESPONSIVE` |
| 2 | Brief violations | Wrong audience tone, missing primary action |
| 3 | Hierarchy and composition | Unclear first read, flat structure |
| 4 | Detector errors | Slop and library rules at error severity |
| 5 | Craft and copy | Missing states, vague labels |
| 6 | Warnings and info | Taste level items |

Cap the list at the top five or six items. A long list means nothing gets fixed.

## Self critique questions

- Could this be any product, or only this one?
- Which default generated look does it resemble (`NS-LOOK-DEFAULT-PALETTE`, `NS-SLOP-CARD-GRID`, `NS-SLOP-HERO-METRIC`)?
- Is there exactly one bold choice, and is it the right one?
- Does every element earn its place?
- What breaks first on a small screen or with long text?

## What to record

Call `record_critique` with the overall score, the dimension scores, the top findings and the rule ids involved. It appends an entry to `design/decisions.md`. Add which findings were accepted as allowed and why, and the next stage, normally Polish.

## Pitfalls

| Pitfall | Correction |
|---|---|
| Scoring from code alone | Always look at screenshots |
| Uniform 7s | Use the full range and cite evidence |
| Praising to be polite | State what is generic and why |
| Fixing during critique | Record first, then fix in Polish |
| Ignoring the mode weights | Score with the mode's weights |

## Exit checks

- Screenshots reviewed at two widths.
- Rubric scored with evidence, gates applied.
- Findings ranked, five or six at most.
- Critique entry recorded.
