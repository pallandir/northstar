# Typography
Load when: choosing fonts, a type scale, or sizing and spacing text in any screen or page.

## Principles
- Type carries the personality. Decide the voice from the subject and mood in DESIGN.md before picking a family.
- One family with a real range of weights, or two clearly distinct families (for example a serif display with a neutral sans body). Never two similar sans faces (NS-TYPE-FONT-COUNT).
- A training data default as the display face is a warning unless the brief chose it (NS-TYPE-DEFAULT-DISPLAY). Quiet Inter body text in Operate is fine.
- Hierarchy comes from size, weight and contrast between steps, not from adding families or colours.
- Define the scale once as tokens and use only those sizes (NS-TYPE-SCALE).
- Fonts come from a package or service, never hand managed files (NS-LIB-FONT).
- Readability limits are fixed: measure, line height and contrast hold in every mode.

## Do
- Library first: Fontsource variable fonts (`@fontsource-variable/<family>`), `next/font/google` in Next.js, or a Google Fonts stylesheet with `display=swap` in plain HTML. Never hand roll `@font-face` for a catalogue family.
- Font resolver workflow: call `resolve_font` with subject and mood, take 2 to 3 candidates, record the reason, then verify the chosen family exists and ships the weights and axes you use before writing CSS.
- Scale tokens: `--text-xs` to `--text-4xl`.
- Operate uses ratio 1.125 to 1.25 between steps (NS-TYPE-SCALE).
- Read 1.2 to 1.25.
- Persuade 1.25 to 1.5.
- Experience may go larger.
- Body 16px minimum on mobile, 16 to 18px for long reading.
- Labels and captions not below 12px.
- Fluid sizes for headings only: `font-size: clamp(2rem, 1.2rem + 3vw, 4.5rem)`.
- Keep the maximum inside the mode cap (NS-TYPE-DISPLAY-MAX).
- Never clamp with a `vw` only value, so browser zoom still scales it.
- Measure: prose containers `max-width: 65ch`, never above 75ch (NS-TYPE-MEASURE).
- Line height: 1.5 to 1.65 for body, 1.1 to 1.25 for large display, 1.3 to 1.4 for UI labels.
- Add 0.05 for light text on dark.
- Weight: use 2 to 3 weights (400, 500 or 600, 700).
- Tracking: 0 for body, slightly negative for large display but not below -0.04em (NS-TYPE-TRACKING-FLOOR), slightly positive for small uppercase.
- Numbers in tables, prices and metrics: `font-variant-numeric: tabular-nums`.
- Use `text-wrap: balance` on headings and `pretty` on paragraphs.
- Pairing logic: contrast on one axis (serif and sans, or wide and narrow) and match on x height and mood.
- A display face needs a body partner built for text sizes.
- Pair a display face with a body face that differs in structure, and test both with real headings and real paragraphs.
- Call `resolve_library` when a text component such as a prose or table wrapper is needed, instead of hand building one.

## Avoid
- Picking from memory the faces in NS-TYPE-DEFAULT-DISPLAY without a reason in DESIGN.md.
- Three or more families, or faux bold and faux italic from a family that lacks them (NS-TYPE-FONT-COUNT).
- Display text above the mode cap with no allow entry (NS-TYPE-DISPLAY-MAX).
- Tight display tracking that makes glyphs collide (NS-TYPE-TRACKING-FLOOR).
- Gradient text, tracked caps as the default label style, eyebrows, monospace as decoration (NS-SLOP-GRADIENT-TEXT, NS-SLOP-CAPS-LABELS, NS-SLOP-EYEBROW, NS-SLOP-MONO-COSTUME).
- One word in a headline set in an accent style (NS-SLOP-SINGLE-WORD-ACCENT).
- Skipping steps so sizes are arbitrary pixel values outside the scale.

## By mode
| Mode | Display cap | Scale and tone |
| --- | --- | --- |
| operate | 3rem | Compact scale, ratio up to 1.25, system or quiet sans, tabular numerals everywhere data appears |
| read | 3.5rem | Comfortable 17 to 18px body, 60 to 70ch, line height 1.6, serif or text sans designed for reading |
| persuade | 6rem | Confident display face from the resolver, strong size contrast, headline under 12 words |
| experience | 12rem | Display may exceed the cap through an allow entry with a reason, expressive pairing, still readable body |

## Checks
- Computed font families on the page are at most two (NS-TYPE-FONT-COUNT).
- Every font size maps to a scale token (NS-TYPE-SCALE).
- Largest heading at 1440px is within the cap for the mode (NS-TYPE-DISPLAY-MAX).
- Paragraph width in `ch` is at most 75 (NS-TYPE-MEASURE).
- Letter spacing is never below -0.04em (NS-TYPE-TRACKING-FLOOR).
- Font loading uses a package or loader with swap (NS-LIB-FONT).
- Display family is not a listed default without a recorded reason (NS-TYPE-DEFAULT-DISPLAY).
- Page at 200% zoom and 360px width keeps text readable with no clipped lines.
