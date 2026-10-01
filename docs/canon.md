# Northstar rule index

Generated from `canon/rules`. Do not edit by hand.

53 rules. Severity is the default, modes can raise or lower it.

## Accessibility floor

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-A11Y-CONTRAST` | Text and control contrast | error | no | static |
| `NS-A11Y-FOCUS-VISIBLE` | Keyboard focus stays visible | error | no | static |
| `NS-A11Y-TARGET-SIZE` | Touch and pointer target size | warn | no | static |
| `NS-A11Y-REDUCED-MOTION` | Reduced motion is honoured | error | no | static |
| `NS-A11Y-SEMANTICS` | Real semantics for interactive elements | error | no | static |

## Colour

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-COLOR-PURE-BLACK` | Pure black or white surfaces | warn | yes | static |
| `NS-COLOR-GRAY-ON-COLOR` | Grey text on a coloured surface | warn | yes | static |
| `NS-COLOR-PALETTE-SIZE` | A small named palette with one accent | warn | yes | advisory |
| `NS-COLOR-RAW-VALUES` | Raw colour values instead of tokens | warn | yes | static |
| `NS-COLOR-THEME-CHOICE` | Light or dark chosen from the use scene | info | yes | advisory |

## Copy

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-COPY-CTA-VERB` | Vague action labels | warn | yes | static |
| `NS-COPY-ERROR` | Errors that do not name the problem and the recovery | warn | yes | advisory |
| `NS-COPY-FILLER` | Generic marketing filler and placeholder text | warn | yes | static |
| `NS-COPY-EMPTY-STATE` | Empty screens without direction | warn | yes | advisory |

## Layout

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-LAYOUT-SPACING-RHYTHM` | Grouping through spacing | warn | yes | advisory |
| `NS-LAYOUT-RESPONSIVE` | Works from 360px up | error | no | dom |
| `NS-LAYOUT-STATES` | Every state is designed | warn | yes | advisory |
| `NS-LAYOUT-MODAL-OVERUSE` | Modal for a task that needs no interruption | info | yes | advisory |
| `NS-LAYOUT-CENTER-EVERYTHING` | Everything centred | info | yes | advisory |
| `NS-LAYOUT-FIRST-VIEW` | The first view shows the subject | info | yes | advisory |

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
| `NS-MOTION-EASING` | Custom easing instead of the default keywords | info | yes | static |
| `NS-MOTION-PROPERTIES` | Animate cheap properties | warn | yes | static |
| `NS-MOTION-SCROLLJACK` | Scroll hijacking | error | yes | static |

## Anti slop

| Rule | Title | Severity | Allowable | Detection |
|---|---|---|---|---|
| `NS-SLOP-GRADIENT-TEXT` | Gradient text | error | yes | static |
| `NS-SLOP-SIDE-BORDER` | Thick coloured side border | error | yes | static |
| `NS-SLOP-HARD-SHADOW` | Hard offset shadow | error | yes | static |
| `NS-SLOP-EYEBROW` | Eyebrow label above a heading | error | yes | static |
| `NS-SLOP-CAPS-LABELS` | Tracked all caps labels as a default | warn | yes | static |
| `NS-SLOP-EMOJI-ICON` | Emoji or glyphs standing in for icons | error | yes | static |
| `NS-SLOP-NESTED-CARD` | Card inside a card | error | yes | static |
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
