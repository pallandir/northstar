# Motion
Load when: adding transitions, animation, hover or scroll effects, or loading and entrance behaviour.

## Principles
- Motion explains a change of state or draws attention to one thing. It is never wallpaper.
- One authored moment per view at most (NS-MOTION-ONE-MOMENT). Everything else is still or gives feedback.
- Respond to user actions fast and quietly. Reserve expressive motion for moments the user did not trigger.
- Authored motion uses a custom exponential ease out curve defined once as a token (NS-MOTION-EASING).
- Animate cheap properties, transform and opacity (NS-MOTION-PROPERTIES).
- Reduced motion is honoured always, and this cannot be waived (NS-A11Y-REDUCED-MOTION).
- Motion never blocks input or delays content the user came for.
- Layout shift counts as unwanted motion. Reserve space for what loads.

## Do
- Duration tokens: `--dur-instant: 100ms` for press and toggle, `--dur-fast: 150ms` for hover and focus, `--dur-base: 250ms` for menus and panels, `--dur-slow: 400ms` for the page level moment.
- Exits run about 70% of the entrance time.
- Easing tokens: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` for entrances and the default, `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)` for movement across the screen.
- Keywords such as `ease` are acceptable for trivial colour feedback.
- List exact properties: `transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)` (NS-MOTION-TRANSITION-ALL).
- To open and close height, use `grid-template-rows: 0fr` to `1fr` or the Web Animations API, and not an animated `height`.
- Gate authored animation: `@media (prefers-reduced-motion: no-preference) { ... }`.
- Under reduce, swap movement for a fade or no change, and keep state feedback visible.
- Stagger a set with a small step, 30 to 60ms, capped at about 8 items.
- Pick the moment: one hero reveal, one number counting up, one transition between routes.
- State it in DESIGN.md.
- Library first for complex work: the Motion library (`motion`) for gestures and layout animation, CSS for the rest.
- Scroll libraries only after an opt in.
- Use `resolve_library` for animation needs.
- Loading: skeletons that match final layout, spinners only for waits under about 2s.
- Pause looping animation when off screen.
- Interrupt safely: animations can be cancelled and reversed mid flight.
- Keep hover movement small: 1 to 2px of translate or a colour change, never a large scale jump.
- Press feedback on buttons within 100ms, and respond to the pointer even when work continues in the background.
- Prefer view transitions for route changes when supported, with a plain fallback.
- Keep looping or ambient motion subtle, slow and pausable.

## Avoid
- `transition: all` (NS-MOTION-TRANSITION-ALL).
- Bounce and elastic easing, which reads as dated and is an error in Operate (NS-MOTION-BOUNCE).
- The same fade up on every section (NS-MOTION-SECTION-ENTRANCE).
- Scroll hijacking, custom scroll speed and snap that fights the wheel (NS-MOTION-SCROLLJACK).
- Animating `width`, `height`, `top`, `left` or box shadow on large areas (NS-MOTION-PROPERTIES).
- Parallax and autoplay loops with no reduced motion path (NS-A11Y-REDUCED-MOTION).
- Hard offset shadows as a hover effect (NS-SLOP-HARD-SHADOW).

## By mode
| Mode | Motion budget |
| --- | --- |
| operate | Functional only: 100 to 200ms feedback, panel and menu transitions, no entrances, no bounce (error), severity info for the moment rule |
| read | Functional only: link and focus feedback, optional reading progress, nothing near the text that moves |
| persuade | One signature moment at the first view or key proof, plus feedback. Section entrances flagged |
| experience | May choreograph a sequence and use scroll driven effects with a reduced motion fallback. Scroll libraries by opt in in DESIGN.md |

## Checks
- Count of authored animations per view is at most one outside Experience (NS-MOTION-ONE-MOMENT).
- No `transition: all`, no bounce curves, easing values come from tokens (NS-MOTION-TRANSITION-ALL, NS-MOTION-BOUNCE, NS-MOTION-EASING).
- Animated properties are transform and opacity unless measured (NS-MOTION-PROPERTIES).
- With reduced motion emulated, nothing moves apart from direct response to input (NS-A11Y-REDUCED-MOTION).
- No section by section entrance pattern, no scroll hijack (NS-MOTION-SECTION-ENTRANCE, NS-MOTION-SCROLLJACK).
- Interaction stays responsive with CPU throttled, and there is no layout shift on load.
