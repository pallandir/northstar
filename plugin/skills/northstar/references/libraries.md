# Libraries
Load when: choosing, installing or replacing a component library, icon set or font, or when a hand rolled component is about to be written.

## Policy

Never hand roll what a library already provides. The mapping from need to library per stack is in `libraries.yaml`. Three checks enforce it: this text, the resolver tools, and the detector rules `NS-LIB-ICON`, `NS-LIB-OVERLAY`, `NS-LIB-FONT`, `NS-LIB-TOAST` and `NS-LIB-PRIMITIVE`.

## Resolve first

Call the resolver before writing code.

| Need | Tool | Input |
|---|---|---|
| Component, form, table, toast, chart, motion | `resolve_library` | The need and the stack |
| Icon | `resolve_icon` | The concept and the icon library in DESIGN.md |
| Font | `resolve_font` | Subject, mood and mode |

The result gives the package, the install command and the stack specific notes. Record the choices in `northstar.libraries` in DESIGN.md so later work reuses them.

## Default choices by need

| Need | Default (React) | Other stacks |
|---|---|---|
| Dialog, menu, select, tabs, tooltip | shadcn/ui on Radix | shadcn-vue, shadcn-svelte, Angular CDK, Kobalte, native elements in HTML |
| Icons | Lucide | Lucide packages per framework, Material Symbols, Iconify, Phosphor as alternatives |
| Fonts | Fontsource variable fonts, `next/font` in Next.js | Fontsource, or Google Fonts with display swap in HTML |
| Toast | Sonner | Equivalent per framework |
| Table | TanStack Table | Same family per framework |
| Form | React Hook Form with Zod | VeeValidate, Superforms, Angular forms |
| Chart | Recharts through the shadcn chart component | Chart.js and others per stack |
| Motion | Motion | Svelte transitions, Angular animations, CSS and View Transitions in HTML |
| Command palette | cmdk through shadcn command | shadcn variants |

Smooth scroll with Lenis is for experience mode only, and scroll hijacking is an error (`NS-MOTION-SCROLLJACK`).

## Install safely

1. Read `package.json` and the lockfile. If the package is already installed, use it.
2. Check the package exists and is maintained: `npm view <package> name version time.modified`. Reject names you cannot confirm, since models invent packages.
3. Prefer the project's package manager, detected from the lockfile.
4. For shadcn, prefer the registry flow: run `components.json` setup once with `npx shadcn@latest init`, then add components by name with `npx shadcn@latest add <component>`. Components are copied into the project and styled with tokens.
5. Install fonts as `@fontsource-variable/<family>` and import only the weights needed.
6. Pin nothing by hand: let the manager write the version, then commit the lockfile.

## Icons

Use one library at one stroke and size across the product. The set already in the project or named in DESIGN.md wins. Otherwise `resolve_icon` picks one, and Lucide, Phosphor and Tabler are equal choices. Import icons by name. Never paste inline path data or use emoji and glyphs as icons (`NS-LIB-ICON`, `NS-SLOP-EMOJI-ICON`). Decorative icons are hidden from assistive technology, meaningful ones have a label.

## Fonts

Use `resolve_font` with the subject and mood. A training data default as the display face draws a warning unless the brief chose it (`NS-TYPE-DEFAULT-DISPLAY`). Self managed font files are flagged (`NS-LIB-FONT`). Set display swap and keep to one or two families.

## When hand rolling is acceptable

Only with an explicit allow and a reason a reviewer can judge.

| Valid reason | Example |
|---|---|
| The library cannot do the job | A bespoke data visualisation no chart library supports |
| The brief demands it | A hand drawn brand mark or custom pictogram set |
| Bundle or platform limit | Embedded widget with a strict size budget |

Record the allow in `northstar.allow` with rule, reason and scope, or inline as `northstar-allow <ID>: <reason>`. Log it in `design/decisions.md`. Convenience is not a reason.

## Recommended external MCPs

| Server | Use |
|---|---|
| shadcn MCP | Browse and add components from any registry, set up with `npx shadcn@latest mcp init` |
| Figma remote MCP | Read variables, frames and design context from Figma. Install steps are in `references/figma.md` |
| Iconify and Lucide MCPs | Search icons with licence information |

These complement the Northstar resolver. They do not replace the policy.

## Pitfalls

| Pitfall | Correction |
|---|---|
| Installing a guessed package name | Run `npm view` first |
| Copying a component then rewriting it by hand | Extend through props and tokens |
| Mixing two icon sets | Choose one, record it |
| Allowing a rule silently | Reason and log are required |
