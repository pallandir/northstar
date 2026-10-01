# The Northstar method

Northstar steers an AI agent through UI work the way a good design lead would: ask before guessing, decide a direction, build a system, compose from real libraries, then critique and polish. It exists to stop the generic look that unguided agents produce, and it does that with a small set of rules, one set of artifacts and tools that load only when needed.

You bring one thing: a design direction or design system as a markdown file. Everything else is the agent's job, guided by Northstar.

## The six stages

| Stage | What happens | What it leaves behind |
|---|---|---|
| Brief | Who it is for, the primary job, success, constraints | `PRODUCT.md` |
| Direction | Pick a mode, weigh two or three named directions grounded in the subject | an entry in `design/decisions.md` |
| System | Tokens, type roles, libraries, component states | `DESIGN.md` |
| Compose | Plan the layout first, review the plan against the brief, then build library first | code |
| Critique | Screenshots, the rubric, a detector run | a critique entry in the decisions log |
| Polish | States, copy, one motion moment, accessibility, responsive behaviour | detector clean, or findings allowed with a reason |

Refine means critique then polish. Adapt carries a design to a new target such as a theme or a breakpoint. Modernise derives a brief and a system from existing code, then proposes changes in safe increments. The agent runs these as prompts: `brief`, `direct`, `system`, `compose`, `critique`, `polish`, `adapt` and `modernise`.

## Modes

The mode in `DESIGN.md` changes how strict the rules are.

| Mode | For | Motion | Display type cap |
|---|---|---|---|
| operate | apps, dashboards, tools | functional only | 3rem |
| read | docs, articles | functional only | 3.5rem |
| persuade | marketing, landing pages | one signature moment | 6rem |
| experience | portfolios, brand sites | choreography, with a reduced motion path | 12rem |

## Bringing your own direction

Hand the agent any markdown: a brand brief, a Notion export, a few notes with hex values. The `design_md_normalize` tool drafts a `DESIGN.md` from it. It pulls out colours by role, fonts, radius, spacing, mode and libraries, keeps your original text verbatim in an `Imported direction` section, and reports what is missing. The agent then asks only about the gaps, at most three questions at a time, each with a default so that "go" is a valid answer.

Starting from nothing, `design_system_propose` drafts a system for a product from the curated data: a palette for the product type, a font pairing for the mood, a style. It validates the draft, including contrast, and never writes a file until you have seen it.

## Library first

The agent does not hand roll what a library already provides. The `resolve_library`, `resolve_font` and `resolve_icon` tools return the choice for your stack: shadcn/ui or the framework equivalent for dialogs and menus, Sonner for toasts, TanStack for tables, Lucide or Material Symbols for icons, Fontsource for fonts. The agent confirms the package exists before installing it. Hand rolling is allowed only with an explicit `northstar.allow` entry in `DESIGN.md`, or when you ask for it.

## When guidance conflicts

Sources of design advice contradict each other on fonts, gradients, motion and more. Northstar resolves this in a fixed order:

1. The accessibility floor, which nothing lowers.
2. The explicit brief: `DESIGN.md`, `PRODUCT.md` or a direct instruction.
3. The mode.
4. The craft floor, the generic defaults the canon refuses.
5. Suggestions from the curated data, which are candidates only.

Every resolved conflict is listed in [the rule index](./canon.md), with the rule it maps to.

## Browser comments

A comment left with the extension is resolved with the same discipline. The handoff carries a design context block built only from structured fields: the DESIGN.md tokens for the property the comment is about, the libraries in use, the mode and the relevant rules. The agent changes the token or the shared component when `DESIGN.md` defines it, instead of patching one instance. After the agent resolves a comment it scans the files it edited and reports detector errors.

## Where things live

| Thing | Location |
|---|---|
| The canon: rules, references, rubric, library map | `canon/` |
| The router skill and references an agent reads | `plugin/skills/northstar/` |
| Curated design data | `packages/data/json/` |
| The scanner | `packages/detector/` |
| DESIGN.md tools | `packages/design-md/` |
