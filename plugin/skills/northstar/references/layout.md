# Layout
Load when: structuring a page or component, setting spacing, grid, responsive behaviour or UI states.

## Principles
- Spacing expresses grouping. Related things sit close, separate groups sit far, and the difference is visible (NS-LAYOUT-SPACING-RHYTHM).
- Use one spacing scale as tokens, on a 4px base, and nothing off the scale.
- Content decides the structure. Do not wrap everything in cards, and never nest a card in a card (NS-SLOP-NESTED-CARD).
- The layout works from 360px up, with real content, and this is not waivable (NS-LAYOUT-RESPONSIVE).
- Every state is designed: default, hover, focus, active, disabled, loading, empty, error, success (NS-LAYOUT-STATES).
- A strong left edge and consistent alignment beat decoration. Centre only short, single focus areas (NS-LAYOUT-CENTER-EVERYTHING).
- The first view shows the subject in Persuade and Experience (NS-LAYOUT-FIRST-VIEW).
- Interrupt only when the task truly blocks (NS-LAYOUT-MODAL-OVERUSE).

## Do
- Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96 as `--space-1` upward.
- Inside a group use 4 to 12, between groups 24 to 48, between sections 64 to 128.
- Prefer `gap` over margins.
- Use `flex` for one dimension and `grid` for two.
- Use `repeat(auto-fit, minmax(min(100%, 16rem), 1fr))` for fluid card sets that need no breakpoints.
- Container queries for components: `container-type: inline-size` on the wrapper, then `@container (min-width: 32rem)`.
- Use media queries only for page level shell changes.
- Test at 360, 768, 1024 and 1440px.
- Content wraps, nothing scrolls sideways, long strings and translated labels do not break the row.
- Use `min-height: 100dvh`, not `100vh`, because mobile browser chrome makes 100vh taller than the visible area (NS-LAYOUT-VIEWPORT-HEIGHT).
- Respect safe areas with `env(safe-area-inset-*)` on fixed bars.
- Align to a shared baseline or edge.
- Optical fixes: icons beside text are centred on the cap height, numeric columns are right aligned.
- States: skeleton or inline spinner for loading over 300ms, empty state with direction (see copy), error with recovery, disabled that explains why when it is not obvious.
- Overlays, menus and popovers use library primitives (shadcn, Radix, Reka, Bits, native `dialog` and `popover`) and not hand rolled code (NS-LIB-OVERLAY).
- Call `resolve_library` for the need.
- Pointer targets are at least 24px and touch targets 44px, grown by padding or a pseudo element and not by enlarging the visual (NS-A11Y-TARGET-SIZE).
- Z index from a short token list: base, sticky, overlay, modal, toast.
- Icons come from Lucide, Material Symbols or Iconify through `resolve_icon`, never hand drawn paths (NS-LIB-ICON).
- Keep one primary action per view, placed where the reading path ends.
- Sticky headers and bars keep content reachable, so offset anchors with `scroll-margin-top`.

## Avoid
- Uniform padding everywhere so nothing groups (NS-LAYOUT-SPACING-RHYTHM).
- Fixed pixel widths, desktop only layouts, hidden overflow that clips content (NS-LAYOUT-RESPONSIVE).
- Identical icon, heading, text card grids as the page structure (NS-SLOP-CARD-GRID).
- A hero that is only a big number with a small label (NS-SLOP-HERO-METRIC), decorative section numbers (NS-SLOP-NUMBERED-SECTIONS), template chrome (NS-SLOP-TEMPLATE-CHROME).
- A modal for something that could be inline (NS-LAYOUT-MODAL-OVERUSE).
- Everything centred (NS-LAYOUT-CENTER-EVERYTHING).
- Missing empty, loading and error states (NS-LAYOUT-STATES).

## By mode
| Mode | Density and structure |
| --- | --- |
| operate | Dense but calm, 8 to 16px gaps, tables and lists over cards, persistent navigation, all states required as errors |
| read | Single column near 65ch, generous vertical rhythm of 1.5 line units, side notes only when wide, no chrome competing with text |
| persuade | Spacious sections, a clear first view with the product, one idea per section, varied rhythm, consistent CTA placement |
| experience | Asymmetry and scale allowed, centring allowed, grid may break on purpose, still responsive from 360px |

## Checks
- Computed gaps come from the scale and groups differ visibly (NS-LAYOUT-SPACING-RHYTHM).
- No horizontal scroll at 360px (NS-LAYOUT-RESPONSIVE).
- Each interactive component shows hover, focus, disabled, loading and error (NS-LAYOUT-STATES).
- Targets measure at least 24px, and 44px on touch (NS-A11Y-TARGET-SIZE).
- Full height sections use dvh or svh (NS-LAYOUT-VIEWPORT-HEIGHT).
- The layout matches the variance and density dials recorded in DESIGN.md (NS-LAYOUT-TASTE-DIALS).
- No nested cards, card grid structure, or hero metric (NS-SLOP-NESTED-CARD, NS-SLOP-CARD-GRID, NS-SLOP-HERO-METRIC).
- First view in a screenshot names what the product is (NS-LAYOUT-FIRST-VIEW).
