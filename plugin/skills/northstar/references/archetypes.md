# Archetypes
Load when: choosing or blending a visual direction, a request describes a feel or names a style or reference site, or one style must adapt to a new need.

## Goal

Northstar covers many styles with one engine. An archetype is a recipe: a hue and chroma, neutral temperature, shape, density, motion feel, fonts, a depth model and a few layout moves. The recipe feeds `design_tokens_generate`, so every style comes with contrast checked tokens and the same professional floor. Pick one, blend two, then adapt it to the brief.

## Read the request

| The request sounds like | Start from |
|---|---|
| Clean, quiet, simple, restrained | minimalist |
| Friendly, gentle, calm, rounded | soft |
| Warm, human, approachable product | warm |
| Fast, exact, a tool for experts | precise |
| Developer tool, terminal, code, docs | technical |
| Dense data, analysts, many columns | dense |
| Magazine, long reading, a point of view | editorial |
| Grid, flush left, typographic, rational | swiss |
| Raw, loud, mechanical, anti polish | brutalist |
| Launch, confident, big, one message | bold |
| Fun, kids, games, bright | playful |
| Premium, high end, fashion, slow | luxury |

If the user names a product or site as a mood, read it for character only: density, shape, contrast, motion. Choose the closest archetype, say which one and why, and do not copy its layout or marks.

## Pick

1. Set the mode first. The archetype must suit it (the entry lists the modes).
2. Search with `canon_find` using `kind` archetype and the words of the brief, or read the table above. `arch:<id>` returns the full recipe.
3. Offer two or three options when the brief is open, each with its risk, and mark one as the default so go works.
4. Record the choice and the rejected options in `design/decisions.md`.

## Blend

A blend is one primary archetype plus one secondary influence. It lets a precise product borrow soft surfaces without becoming soft.

- The secondary may contribute `surface` (shape and depth), `type` (the font pairing) or `motion` (the feel). Pick one to three.
- The secondary never changes the mode, the density, the accessibility floor or the library choices.
- Name what is taken. A blend that cannot say what the secondary contributes is two directions fighting.
- Pass `secondary` and `takes` to `design_tokens_generate`. It records the blend in `northstar.archetype`.

Good blends have a clear job for each side: minimalist structure with soft surfaces, precise density with editorial headings, bold colour with swiss alignment. Avoid blends where both sides want a different density.

## Adapt to the need

- A supplied brand wins. Pass its hex as `brand` so the hue seeds the ramp, keep its fonts and radii, and use generated neutrals, shadows and motion only where the brief is silent.
- Override single seeds when the brief is specific: a different shape, a denser density or a calmer feel.
- Move the taste dials by the brief. A trust first product lowers variance and motion, an experimental brief raises them (`references/direction.md`).
- When two stakeholders disagree, show the same screen in two archetypes before debating adjectives.

## Composition moves

These carry a screen from correct to memorable. Use one or two, not all.

- Asymmetric split: a wide text column against a narrow image or proof column, instead of three equal cards.
- Scale contrast: one very large element against small precise detail.
- Real product imagery: a live demo, a real screenshot or a photograph, never a stack of abstract shapes.
- A single signature moment: one considered motion or composition event per page (`NS-MOTION-ONE-MOMENT`).
- Rhythm: change the layout family from section to section. Do not repeat the same split three times.
- Hero discipline: a headline, one line of support and one primary action, with proof directly below. Keep logo walls under the hero.
- Long lists get a better structure than a stack of rows: a table, tabs, a grouped list or a bento when the items differ in weight.

## Archetypes at a glance

| id | Modes | Character |
|---|---|---|
| minimalist | operate, read, persuade | Crisp, pure neutrals, one accent |
| soft | operate, persuade | Round, warm, airy, tinted shadows |
| warm | operate, persuade | Friendly and rounded, warm neutrals |
| precise | operate | Cool, exact, balanced density |
| technical | operate, persuade | Dense, monospace for data, cool signal colour |
| dense | operate | Cockpit, borders only, tight rows |
| editorial | read, persuade, experience | Serif voice, hairlines, asymmetric |
| swiss | read, persuade | Grid, flush left, sharp |
| brutalist | persuade, experience | Raw, hard edges, one hot colour |
| bold | persuade, experience | Saturated, large, expressive |
| playful | persuade, experience | Round, bright, springy |
| luxury | persuade, experience | Sharp, airy, display serif |

## Pitfalls

| Pitfall | Correction |
|---|---|
| Choosing by trend name | Choose by mode, audience and mood |
| Blending three or more styles | One primary, one secondary |
| Copying a reference site | Take its character, not its layout |
| Ignoring a supplied brand | The brand seeds the generator |
| Overriding contrast to keep a look | Contrast is the floor, change the hue or lightness |

## Exit checks

- One archetype, with an optional blend that names what it takes.
- Tokens generated and `design_md_validate` clean.
- The choice and the rejected options are in `design/decisions.md`.
