# Northstar rule index

Generated from `canon/rules`. Do not edit by hand.

77 rules. Severity is the default, modes can raise or lower it.

## Accessibility floor

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-A11Y-CONTRAST` | Text and control contrast | error | no | tokens |
| `NS-A11Y-FOCUS-VISIBLE` | Keyboard focus stays visible | error | no | static |
| `NS-A11Y-TARGET-SIZE` | Touch and pointer target size | warn | no | dom |
| `NS-A11Y-REDUCED-MOTION` | Reduced motion is honoured | error | no | static |
| `NS-A11Y-SEMANTICS` | Real semantics for interactive elements | error | no | static |

## Colour

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-COLOR-PURE-BLACK` | Pure black or white surfaces | warn | yes | static |
| `NS-COLOR-GRAY-ON-COLOR` | Grey text on a coloured surface | warn | yes | dom |
| `NS-COLOR-PALETTE-SIZE` | A small named palette with one accent | warn | yes | advisory |
| `NS-COLOR-RAW-VALUES` | Raw colour values instead of tokens | warn | yes | static |
| `NS-COLOR-THEME-CHOICE` | Light or dark chosen from the use scene | info | yes | advisory |
| `NS-COLOR-DARK-PARITY` | Light and dark themes keep the same hierarchy | warn | yes | advisory |

## Copy

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-COPY-CTA-VERB` | Vague action labels | warn | yes | static |
| `NS-COPY-ERROR` | Errors that do not name the problem and the recovery | warn | yes | advisory |
| `NS-COPY-FILLER` | Generic marketing filler and placeholder text | warn | yes | static |
| `NS-COPY-EMPTY-STATE` | Empty screens without direction | warn | yes | advisory |
| `NS-COPY-PLACEHOLDER-DATA` | Placeholder names and fake round statistics | warn | yes | advisory |

## FINISH

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-FINISH-FLAT-SHADOW` | Single layer pure black shadow | warn | yes | static |
| `NS-FINISH-PRESS-STATE` | Button with a hover state and no pressed state | warn | yes | static |
| `NS-FINISH-HOVER-GATE` | Hover transform not limited to hover capable devices | info | yes | static |
| `NS-FINISH-TABULAR-NUMS` | Figures without tabular numerals | info | yes | static |
| `NS-FINISH-TEXT-WRAP` | Headings without balanced wrapping | info | yes | static |
| `NS-FINISH-Z-INDEX` | Arbitrary huge z-index | warn | yes | static |
| `NS-FINISH-CONCENTRIC-RADIUS` | Nested radii that do not nest | info | yes | advisory |
| `NS-FINISH-SATURATED-BORDER` | Saturated pastel border on a neutral surface | warn | yes | static |

## Layout

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-LAYOUT-SPACING-RHYTHM` | Grouping through spacing | warn | yes | advisory |
| `NS-LAYOUT-RESPONSIVE` | Works from 360px up | error | no | dom |
| `NS-LAYOUT-STATES` | Every state is designed | warn | yes | advisory |
| `NS-LAYOUT-MODAL-OVERUSE` | Modal for a task that needs no interruption | info | yes | advisory |
| `NS-LAYOUT-CENTER-EVERYTHING` | Everything centred | info | yes | advisory |
| `NS-LAYOUT-FIRST-VIEW` | The first view shows the subject | info | yes | advisory |
| `NS-LAYOUT-VIEWPORT-HEIGHT` | Dynamic viewport height for full height sections | warn | yes | static |
| `NS-LAYOUT-TASTE-DIALS` | Design variance, motion intensity and visual density are chosen | info | yes | advisory |

## Library first

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-LIB-ICON` | Hand drawn icons | error | yes | static |
| `NS-LIB-OVERLAY` | Hand rolled dialog, menu, popover, tooltip or select | error | yes | static |
| `NS-LIB-FONT` | Manually managed font files | warn | yes | static |
| `NS-LIB-TOAST` | Hand rolled notifications | warn | yes | static |
| `NS-LIB-PRIMITIVE` | Hand rolled primitive that the stack already provides | warn | yes | advisory |

## Motion

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-MOTION-ONE-MOMENT` | One authored moment | warn | yes | advisory |
| `NS-MOTION-SECTION-ENTRANCE` | The same entrance on every section | warn | yes | static |
| `NS-MOTION-TRANSITION-ALL` | Transition all | error | yes | static |
| `NS-MOTION-BOUNCE` | Bounce and elastic easing | warn | yes | static |
| `NS-MOTION-EASE-IN` | Ease in on interface motion | warn | yes | static |
| `NS-MOTION-SCALE-ZERO` | Entrance from scale zero | warn | yes | static |
| `NS-MOTION-DURATION` | Interface transition longer than 300ms | warn | yes | static |
| `NS-MOTION-EASING` | Custom easing instead of the default keywords | info | yes | static |
| `NS-MOTION-PROPERTIES` | Animate cheap properties | warn | yes | static |
| `NS-MOTION-SCROLLJACK` | Scroll hijacking | error | yes | static |

## PAGE

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-PAGE-PRIMARY-ACTIONS` | One primary action per region | warn | yes | dom |
| `NS-PAGE-ALIGNMENT` | Edges that nearly align | warn | yes | dom |
| `NS-PAGE-LINE-LENGTH` | Comfortable line length | warn | yes | dom |
| `NS-PAGE-HEADING-ORDER` | One h1 and no skipped heading levels | warn | no | dom |
| `NS-PAGE-SMALL-TEXT` | Text under 12px | warn | yes | dom |
| `NS-PAGE-GENERIC-HERO` | The default centred SaaS hero | warn | yes | dom |
| `NS-PAGE-ICON-SQUARES` | Icons in identical rounded tiles | warn | yes | dom |
| `NS-PAGE-GRADIENT` | Gradient text and gradient filled surfaces | warn | yes | dom |
| `NS-PAGE-DRIFT` | The build drifts from the chosen direction | warn | yes | dom |

## Anti slop

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-SLOP-GRADIENT-TEXT` | Gradient text | error | yes | static |
| `NS-SLOP-SIDE-BORDER` | Thick coloured side border | error | yes | static |
| `NS-SLOP-HARD-SHADOW` | Hard offset shadow | error | yes | static |
| `NS-SLOP-EYEBROW` | Eyebrow label above a heading | error | yes | static |
| `NS-SLOP-CAPS-LABELS` | Tracked all caps labels as a default | warn | yes | static |
| `NS-SLOP-EMOJI-ICON` | Emoji or glyphs standing in for icons | error | yes | static |
| `NS-SLOP-NESTED-CARD` | Card inside a card | error | yes | dom |
| `NS-SLOP-CARD-GRID` | Identical icon, heading and text cards as page structure | warn | yes | dom |
| `NS-SLOP-HERO-METRIC` | Big number with a small label as the hero | warn | yes | advisory |
| `NS-SLOP-NUMBERED-SECTIONS` | Decorative section numbers | warn | yes | static |
| `NS-SLOP-MONO-COSTUME` | Monospace as a costume | warn | yes | static |
| `NS-SLOP-DECOR-GLASS` | Glass and blur as decoration | error | yes | static |
| `NS-SLOP-TEMPLATE-CHROME` | Template chrome | warn | yes | static |
| `NS-SLOP-SINGLE-WORD-ACCENT` | One word accented in a headline | info | yes | static |

## Default looks

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-LOOK-DEFAULT-PALETTE` | Default generated palette | warn | yes | static |

## Typography

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-TYPE-DEFAULT-DISPLAY` | Training data default as the display face | warn | yes | static |
| `NS-TYPE-DISPLAY-MAX` | Display size cap | warn | yes | static |
| `NS-TYPE-MEASURE` | Line length | warn | yes | static |
| `NS-TYPE-FONT-COUNT` | At most two families | warn | yes | static |
| `NS-TYPE-SCALE` | Defined type scale | warn | yes | advisory |
| `NS-TYPE-TRACKING-FLOOR` | Tracking floor | warn | yes | static |

## Arbitration

When guidance conflicts, the higher rank wins.

1. **Accessibility floor**: Rules marked allowable false cannot be lowered by any brief or allow entry.
2. **Explicit brief**: DESIGN.md, PRODUCT.md or a direct user instruction overrides taste rules through an allow entry with a reason, logged in decisions.
3. **Mode canon**: Operate, Read, Persuade and Experience change severities and limits.
4. **Global craft floor**: The anti slop defaults apply when the brief is silent.
5. **Data suggestions**: Ported palettes, pairings and styles are candidates, always filtered by every rank above.

## Resolved conflicts

### Which display faces are acceptable

No absolute ban list. A training data default as the display face is a warning unless the brief chose it. Inter is fine as quiet body text in Operate. The font resolver picks from the subject and mood.

Rules: `NS-TYPE-DEFAULT-DISPLAY`, `NS-LIB-FONT`

### Cream grounds, near black grounds and tinted neutrals

Pure black and white surfaces are discouraged, and neutrals are derived from the palette hue. The known default looks are warnings unless the brief asks for them.

Rules: `NS-COLOR-PURE-BLACK`, `NS-LOOK-DEFAULT-PALETTE`

### Gradient text, aurora gradients and glassmorphism

Gradient text is an error unless allowed, with a warning in Experience. Glass is allowed over imagery or maps, not as decoration.

Rules: `NS-SLOP-GRADIENT-TEXT`, `NS-SLOP-DECOR-GLASS`

### Uppercase and monospace labels

Eyebrows are errors outside Operate. Tracked uppercase and monospace labels are warnings, and informational in dense Operate views where they encode real data.

Rules: `NS-SLOP-EYEBROW`, `NS-SLOP-CAPS-LABELS`, `NS-SLOP-MONO-COSTUME`

### How much motion

Operate and Read use functional motion only. Persuade gets one signature moment. Experience may choreograph with a reduced motion fallback and an opt in for scroll libraries.

Rules: `NS-MOTION-ONE-MOMENT`, `NS-MOTION-SECTION-ENTRANCE`, `NS-MOTION-SCROLLJACK`, `NS-A11Y-REDUCED-MOTION`

### Easing keywords versus curves

Authored motion uses a custom cubic bezier from the exponential ease out family, defined once as a token. Keywords are acceptable for trivial state feedback.

Rules: `NS-MOTION-EASING`, `NS-MOTION-BOUNCE`

### Display size

The cap depends on the mode, with Experience allowed to exceed it through a recorded allow entry.

Rules: `NS-TYPE-DISPLAY-MAX`, `NS-TYPE-SCALE`

### Hand built versus library components

Library first. Hand rolled icons, overlays, fonts and primitives are flagged unless the brief or an allow entry says otherwise.

Rules: `NS-LIB-ICON`, `NS-LIB-OVERLAY`, `NS-LIB-FONT`, `NS-LIB-PRIMITIVE`

### Which icon library

The library first policy decides. The icon set already in the project or named in DESIGN.md wins, otherwise resolve_icon picks one by subject and mood, and Lucide stays the stack default for shadcn projects. Phosphor and Tabler are equal alternatives. What is enforced is one library at one stroke and size.

Rules: `NS-LIB-ICON`, `NS-SLOP-EMOJI-ICON`

### Default design variance and the mode

The dials are guidance and start from the mode, never from a fixed default. Operate starts at a low variance and a high density, Read and Persuade sit in the middle, and only Experience starts high. The designer's answer, recorded in DESIGN.md prose, overrides the mode default, and the accessibility floor still applies at every setting.

Rules: `NS-LAYOUT-TASTE-DIALS`, `NS-LAYOUT-CENTER-EVERYTHING`, `NS-LAYOUT-SPACING-RHYTHM`

### Shadows, borders or a flat surface

The archetype decides the depth model and DESIGN.md records it. Soft looks use two or three tinted layers, minimalist and editorial looks use a ring and background steps, brutalist looks need an allow entry for hard shadows. A single black layer is never right, and a flat system is valid when the brief says flat.

Rules: `NS-FINISH-FLAT-SHADOW`, `NS-SLOP-HARD-SHADOW`, `NS-SLOP-DECOR-GLASS`

### Atmosphere versus restraint in motion

The mode sets the budget and frequency sets the amount. Operate animates feedback only, Persuade gets one signature moment, Experience may choreograph with a reduced motion path. Actions repeated all day and anything triggered by keyboard stay instant, and interface transitions stay under 300ms outside Experience.

Rules: `NS-MOTION-ONE-MOMENT`, `NS-MOTION-DURATION`, `NS-MOTION-EASE-IN`, `NS-A11Y-REDUCED-MOTION`

### Generated tokens versus a supplied brand

A supplied brand always wins. Seed the generator with the brand colour, keep the supplied fonts and radii, and use the generated neutrals, shadows and motion tokens only for what the brief leaves open. Contrast must still pass for every pair.

Rules: `NS-LOOK-DEFAULT-PALETTE`, `NS-COLOR-RAW-VALUES`, `NS-A11Y-CONTRAST`
