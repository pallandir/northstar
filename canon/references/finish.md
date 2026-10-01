# Finish
Load when: a screen works and needs depth, shape, borders, type details and surface polish, or when reviewing the elevation, radius and surface tokens.

## Goal

Finish is the layer between competent and professional. It is mostly invisible when right: shadows that look like light, corners that nest, numbers that do not jump, controls that feel pressed. Tokens come from `design_tokens_generate`, so the work here is using them with discipline. Rules start with `NS-FINISH-`.

## Depth

- Build depth from a one pixel ring plus two soft layers, not from one dark shadow (`NS-FINISH-FLAT-SHADOW`). Shadows adapt to any background where a solid border does not.
- Tint every shadow toward the surface hue and keep alpha between 0.04 and 0.2 per layer.
- Light comes from above, so offsets are vertical and the horizontal offset is zero. Keep one direction everywhere.
- Match level to role: xs for controls, sm and md for cards, lg for menus, xl for dialogs. A surface that sits flat on the page gets no shadow.
- Dark theme turns the ring light (white at about 8%) and deepens the shadows. Never reuse the light values.
- A flat system is valid when the brief says flat. Then depth comes from background steps, and the archetype records it.

## Borders and surfaces

- Separate regions by background step first (background, surface, muted), then by a hairline, and only then by a shadow.
- Take border colours from the neutral ramp or from black or white at a low alpha. A pale saturated border reads as candy (`NS-FINISH-SATURATED-BORDER`).
- Keep one border width. One pixel is the default, and thicker is a deliberate emphasis.
- Add a one pixel outline at ten percent opacity to images, inset by one pixel, so photos hold their edge on any background.
- Never use pure black or pure white as a surface (`NS-COLOR-PURE-BLACK`). The generated neutrals are tinted.

## Radius

- Nest radii: the outer radius equals the inner radius plus the padding between them (`NS-FINISH-CONCENTRIC-RADIUS`). A 12px control inside 8px of padding sits in a 20px container.
- Take radii from the scale in DESIGN.md. Each step already adds a padding step, so using adjacent steps for nested surfaces keeps the corners parallel.
- One shape language per product. Pills are for tags and switches, circles for avatars, and everything else follows the scale.
- Sharp systems (2px) still round the focus ring to match the control it surrounds.

## Type detail

- Balance headings and make paragraphs pretty: `text-wrap: balance` on headings and `text-wrap: pretty` on body copy (`NS-FINISH-TEXT-WRAP`).
- Use tabular numerals on prices, totals, counters and table cells (`NS-FINISH-TABULAR-NUMS`) so figures stop shifting when they update.
- Track by size: tighter as type grows, slightly open below 13px. The generated type scale has the values.
- Turn on grayscale font smoothing on macOS at the root so light text on dark does not look heavy.
- Use real typographic characters: curly quotes, the ellipsis character and a non breaking space between a number and its unit.
- Cap the measure of prose near 65 characters (`NS-TYPE-MEASURE`).

## Icons and alignment

- Match icon stroke to text weight: 1.5 beside regular text and 2 beside semibold. Keep one size per context.
- Align optically, not only mathematically. A play triangle, an arrow or a plus next to text often needs a one pixel nudge, and a button with a trailing icon wants less padding on the icon side.
- Give icon only buttons an accessible name and a hit area that is bigger than the glyph.
- Take every icon from one library (`NS-LIB-ICON`).

## Hit areas

- Make targets at least 24px on desktop and 44px on touch (`NS-A11Y-TARGET-SIZE`). Grow the hit area with padding or a pseudo element, not by enlarging the visible control.
- Leave no dead zones: a checkbox or radio shares one target with its label, and neighbouring controls do not leave gaps that swallow clicks.
- Anything that looks interactive is interactive, and the reverse.

## Browser surfaces

- Set `theme-color` and `color-scheme` so browser chrome and scrollbars follow the theme.
- Give every page an accurate title, a favicon and a selection colour from the palette.
- Set `scroll-margin-top` on anchored headings so they clear sticky headers.
- Use dynamic viewport units for full height sections (`NS-LAYOUT-VIEWPORT-HEIGHT`).
- Cap z index on a small named scale (`NS-FINISH-Z-INDEX`).

## Finish checklist

- Every shadow is layered and tinted, and there is a ring or a background step on every raised surface.
- Nested corners are concentric and one shape language is used.
- No pale saturated borders and no pure black or white surfaces.
- Headings balance, paragraphs wrap pretty, figures are tabular.
- Icons share one library, one size per context and a stroke that matches the text.
- Targets meet the size floor and have no dead zones.
- Both themes were opened and compared.
