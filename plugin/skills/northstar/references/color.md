# Color
Load when: building a palette, defining theme tokens, choosing status colours, or designing dark mode.

## Principles
- A palette is a small set of named roles, 4 to 6, with exactly one accent (NS-COLOR-PALETTE-SIZE). Everything else is neutral.
- The accent is rare. It marks the primary action and the one thing that matters on a screen, so it covers well under a tenth of the surface.
- Neutrals are tinted toward the brand hue, not pure grey, black or white (NS-COLOR-PURE-BLACK).
- Colour is referenced by token, never by literal value in components (NS-COLOR-RAW-VALUES).
- Contrast is a floor, not taste: pairs are verified once as tokens, then reused (NS-A11Y-CONTRAST).
- Dark mode is its own design with its own tokens, not an inversion of light.
- Meaning is never carried by colour alone. Pair status colour with an icon or text.
- Choose the default theme from the use scene (NS-COLOR-THEME-CHOICE). Support both when the audience varies.

## Do
- Build in OKLCH so lightness steps are perceptually even: `oklch(0.62 0.17 255)`.
- Hold hue, vary lightness, and lower chroma at the extremes.
- Roles to name: `--bg`, `--surface`, `--text`, `--text-muted`, `--border`, `--accent`.
- Add status tokens separately.
- Neutral ramp: chroma 0.005 to 0.02 at the brand hue, steps from near white to near black, never `#000` or `#fff` as a surface.
- Contrast pairs: body text 4.5:1 or more on its surface, large text (24px, or 19px bold) and UI boundaries 3:1 or more.
- Muted text still needs 4.5:1.
- Check placeholder, disabled hints and text over images.
- Text on a coloured surface is derived from that surface hue or the foreground token, not a grey (NS-COLOR-GRAY-ON-COLOR).
- Status colours: success, warning, danger, info as tokens with a foreground pair each.
- Keep chroma consistent so no status shouts.
- Add an icon and a label.
- Dark mode: surfaces lighter as they elevate (for example L 0.16, 0.2, 0.24), desaturate the accent a little, raise text from pure white to about L 0.93, test contrast again, and re-tune shadows to borders.
- Library first: use shadcn theme tokens (CSS variables) for components, and Tailwind or CSS custom properties for semantic utilities.
- Do not recreate component colours by hand.
- Charts take a categorical set derived from the same hue family plus lightness, validated for contrast and colour vision differences.
- Call `resolve_library` for theming and chart needs, and `resolve_icon` for status icons that accompany colour.
- Keep surfaces to three or four elevation steps, and use borders before shadows.

## Avoid
- Pure black or white surfaces (NS-COLOR-PURE-BLACK).
- Grey text on a tinted or accent background (NS-COLOR-GRAY-ON-COLOR).
- Hex, rgb or hsl literals inside components (NS-COLOR-RAW-VALUES).
- Rainbow palettes, one-off values, and a second competing accent (NS-COLOR-PALETTE-SIZE).
- The default generated looks: purple to blue gradient on white, cream with serif and terracotta, near black with an acid accent, teal and orange.
- Warning unless the brief asks for them (NS-LOOK-DEFAULT-PALETTE).
- Gradient text and decorative glass or blur (NS-SLOP-GRADIENT-TEXT, NS-SLOP-DECOR-GLASS).
- Glass is fine over imagery or maps.
- Thick coloured left borders as card decoration (NS-SLOP-SIDE-BORDER).
- Failing text or control contrast, which no brief can waive (NS-A11Y-CONTRAST).

## By mode
| Mode | Palette approach |
| --- | --- |
| operate | Restrained neutrals, accent only for primary action and selection, strong status tokens, both themes usually needed, tokens enforced as error |
| read | Paper like surface, high contrast text around 7:1, very quiet accent for links, dark theme as a reading preference |
| persuade | One bold accent used with discipline, a clear brand colour at the first view, contrast on every CTA |
| experience | Wide freedom with a committed point of view, still one accent logic, contrast on all text, no default look |

## Checks
- Role count and accent count match the palette (NS-COLOR-PALETTE-SIZE).
- No literal colours in components (NS-COLOR-RAW-VALUES).
- Computed backgrounds are not pure black or white (NS-COLOR-PURE-BLACK).
- All text and control pairs pass 4.5:1 and 3:1 in light and dark (NS-A11Y-CONTRAST).
- No grey text on coloured fills (NS-COLOR-GRAY-ON-COLOR).
- No gradient text or side borders.
- Status is understandable in greyscale and with a colour blindness filter.
- Palette is not a listed default look (NS-LOOK-DEFAULT-PALETTE).
