# Motion
Load when: adding transitions, animation, hover or scroll effects, or loading and entrance behaviour.

## Principles

- Motion explains a change of state or draws attention to one thing. It is never wallpaper.
- Frequency decides amount. The more often an action happens, the less it animates. Things done all day stay instant, things done occasionally get a short transition, and rare first time moments may have a little delight.
- Never animate actions triggered from the keyboard, and never animate things people repeat hundreds of times.
- One authored moment per view at most (`NS-MOTION-ONE-MOMENT`). Everything else is still or gives feedback.
- Respond to user actions fast and quietly. Reserve expressive motion for moments the user did not trigger.
- Reduced motion is honoured always and cannot be waived (`NS-A11Y-REDUCED-MOTION`).
- Motion never blocks input or delays content the user came for. Layout shift counts as unwanted motion.

## Tokens

Use the generated motion tokens. The values by feel:

| Feel | fast | base | slow | drawer |
|---|---|---|---|---|
| snappy | 100ms | 140ms | 200ms | 280ms |
| calm | 120ms | 180ms | 240ms | 320ms |
| expressive | 160ms | 240ms | 320ms | 480ms |

- Press and toggle use fast, hover and focus use fast or base, menus and popovers use base, and panels use slow. Drawers and sheets use drawer.
- Interface motion stays at or under 300ms outside the Experience mode (`NS-MOTION-DURATION`).
- Exits run faster than entrances, about 70% of the entrance time.
- Easing tokens: ease out `cubic-bezier(0.23, 1, 0.32, 1)` for entrances and feedback, ease in out `cubic-bezier(0.77, 0, 0.175, 1)` for movement across the screen and ease drawer `cubic-bezier(0.32, 0.72, 0, 1)` for sheets.

## Easing and entrances

- Never use ease in on interface motion. It starts slowly, so the screen feels like it hesitates after a click (`NS-MOTION-EASE-IN`).
- Define easing once as a token and reuse it (`NS-MOTION-EASING`). The plain keywords feel mechanical, and the exception is trivial colour feedback.
- Never grow an element from scale zero. Start from scale 0.95 with opacity zero (`NS-MOTION-SCALE-ZERO`).
- Set the transform origin where the motion really begins. A popover scales from its trigger, a modal scales from the centre.
- Stagger a set with a small step of 60 to 100ms and cap it at about eight items.
- Prefer springs only for gestures and drag, with a duration near 0.5s and a bounce between 0.1 and 0.3. Bounce and elastic curves are otherwise dated (`NS-MOTION-BOUNCE`).

## Properties and performance

- Animate `transform` and `opacity`, which stay on the compositor (`NS-MOTION-PROPERTIES`).
- List exact properties, such as `transition: opacity var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out)` (`NS-MOTION-TRANSITION-ALL`).
- Open and close height with `grid-template-rows: 0fr` to `1fr` or the Web Animations API, not an animated `height`.
- Prefer CSS transitions for interactions because they can be interrupted and reversed. Use keyframes for staged sequences.
- Pause looping animation when it is off screen.
- Library first for complex work: the Motion library for gestures and layout animation, CSS for the rest. Use `resolve_library` for animation needs.

## Reduced motion and touch

- Gate authored animation with `@media (prefers-reduced-motion: no-preference)`, or add a reduce block that removes movement.
- Under reduce, swap movement for a fade or no change, and keep state feedback visible.
- Gate hover movement with `@media (hover: hover) and (pointer: fine)` (`NS-FINISH-HOVER-GATE`).

## Avoid

- `transition: all` (`NS-MOTION-TRANSITION-ALL`).
- The same fade up on every section (`NS-MOTION-SECTION-ENTRANCE`).
- Scroll hijacking, custom scroll speed and snap that fights the wheel (`NS-MOTION-SCROLLJACK`).
- Parallax and autoplay loops with no reduced motion path.
- Hard offset shadows as a hover effect (`NS-SLOP-HARD-SHADOW`).

## By mode

| Mode | Motion budget |
|---|---|
| operate | Functional only: fast feedback, menu and panel transitions, no entrances, no bounce (error) |
| read | Functional only: link and focus feedback, optional reading progress, nothing near the text that moves |
| persuade | One signature moment at the first view or key proof, plus feedback. Section entrances are flagged |
| experience | May choreograph a sequence and use scroll driven effects with a reduced motion fallback. Scroll libraries only by opt in in DESIGN.md |

## Checks

- At most one authored animation per view outside Experience.
- No `transition: all`, no ease in, no scale zero entrance, no bounce, easing from tokens.
- Durations come from tokens and stay under 300ms for interface feedback.
- With reduced motion emulated, nothing moves apart from direct response to input.
- Interaction stays responsive with the CPU throttled, and nothing shifts on load.
