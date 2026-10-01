# The Northstar method

Northstar steers an AI agent through UI work the way a good design lead would: ask before guessing, decide a direction, build a system, compose from real libraries, then critique and polish. It exists to stop the generic look that unguided agents produce, and it does that with a small set of rules, one set of artifacts and tools that load only when needed.

You can bring a design direction or a design system as a markdown file, or only a short brief. Everything else is the agent's job, guided by Northstar.

## One engine, many styles

Northstar is meant to be the only UI skill a project needs. Direction picks an **archetype**, a recipe with a hue, a neutral temperature, a shape, a density, a motion feel, fonts, a depth model and a few layout moves. There are twelve: minimalist, soft, warm, precise, technical, dense data, editorial, swiss, brutalist, bold, playful and luxury. Any two can be blended. The secondary archetype may lend its surfaces, its type or its motion, and never the mode, the density, the accessibility floor or the library choices.

System then turns the choice into tokens with `design_tokens_generate`, and the same tokens feed the detector, the finish checklist and the critique. A supplied brand colour seeds the hue, so the system matches the brand and the generated parts only fill what the brief leaves open. See [the archetype reference](../canon/references/archetypes.md).

## Create and refine

Two people usually share a screen. An engineer builds it, a designer refines it. The `build` prompt covers the first pass: archetype, tokens, library first composition and a scan. The `refine` prompt covers the second: `ui_audit` counts what is in the code, then one lever is pulled per change in a fixed order (type, colour, states, spacing, depth and shape, motion, composition), with before and after screenshots and a rescan each time. The `finish` prompt is the last detail pass, and `critique` scores the result.

## The six stages

| Stage | What happens | What it leaves behind |
|---|---|---|
| Brief | Who it is for, the primary job, success, constraints | `PRODUCT.md` |
| Direction | Pick a mode, weigh two or three named directions grounded in the subject | an entry in `design/decisions.md` |
| System | Tokens, type roles, libraries, component states | `DESIGN.md` |
| Compose | Plan the layout first, review the plan against the brief, then build library first | code |
| Critique | Screenshots, the rubric, a detector run | a critique entry in the decisions log |
| Polish | States, copy, one motion moment, accessibility, responsive behaviour | detector clean, or findings allowed with a reason |

Refine starts with an audit, then critiques and polishes one lever at a time. Adapt carries a design to a new target such as a theme or a breakpoint. Modernise derives a brief and a system from existing code, then proposes changes in safe increments. The agent runs these as prompts: `brief`, `direct`, `system`, `compose`, `critique`, `polish`, `build`, `refine`, `finish`, `adapt` and `modernise`.

## DESIGN.md comes first

No UI file is created or edited until `DESIGN.md` exists, parses, has no unfilled placeholders and names a mode. This applies to every task, including small edits and polish passes, because a design system that is written afterwards describes the result instead of steering it. `northstar_context` reports the state in its `gate` field and says how to open it. In Claude Code an edit hook enforces the rule by denying edits to UI source files until the gate is open, and other agents are reminded after each edit. Set `NORTHSTAR_GATE=off` to skip it for a session, or install with `--no-gate`.

## Modes

The mode in `DESIGN.md` changes how strict the rules are.

| Mode | For | Motion | Display type cap |
|---|---|---|---|
| operate | apps, dashboards, tools | functional only | 3rem |
| read | docs, articles | functional only | 3.5rem |
| persuade | marketing, landing pages | one signature moment | 6rem |
| experience | portfolios, brand sites | choreography, with a reduced motion path | 12rem |

## Design read and taste dials

Before code the agent states a one line design read: page kind, audience, vibe words and design family. In Direction it then asks one question about three taste dials from 1 to 10: design variance, motion intensity and visual density. The recommended default comes from the mode, for example 3, 2 and 7 for an app and 9, 8 and 3 for a brand showcase. Your answer is recorded as a sentence in the `DESIGN.md` prose, with no schema field, and the build and the critique are judged against it. The dials are guidance, they never lower the accessibility floor. Archetypes are offered when a brief describes a feel. This part of the canon is distilled from taste-skill, see [NOTICE](../NOTICE).

## Bringing your own direction

Hand the agent any markdown: a brand brief, a Notion export, a few notes with hex values. The `design_md_normalize` tool drafts a `DESIGN.md` from it. It pulls out colours by role, fonts, radius, spacing, mode and libraries, keeps your original text verbatim in an `Imported direction` section, and reports what is missing. The agent then asks only about the gaps, at most three questions at a time, each with a default so that "go" is a valid answer.

When the system lives in Figma, install the official Figma MCP server. The agent then reads the variables with `get_variable_defs` and passes them to `design_md_normalize`. Without that server it stops and shows the install commands instead of guessing.

Starting from nothing, `design_system_propose` picks an archetype that fits the product, mood and mode, then generates the tokens, validates the draft including contrast in both themes, and never writes a file until you have seen it. `design_tokens_generate` does the same when you already know the archetype, and can blend two.

## Library first

The agent does not hand roll what a library already provides. The `resolve_library`, `resolve_font` and `resolve_icon` tools return the choice for your stack: shadcn/ui or the framework equivalent for dialogs and menus, Sonner for toasts, TanStack for tables, one icon set such as Lucide, Phosphor or Material Symbols for icons, Fontsource for fonts. The agent confirms the package exists before installing it. Hand rolling is allowed only with an explicit `northstar.allow` entry in `DESIGN.md`, or when you ask for it.

## Search, not loading

The canon is large and an agent should read very little of it. `canon_find` searches reference sections, rules, archetypes and resolved conflicts with plain words. It fixes typos, expands related terms, favours the current stage and returns ids with a one line summary and a token cost inside a small budget. `canon_read` returns one section, and a topic id returns an outline. The same map is available as `northstar://canon/index` and as `references/INDEX.md` in the skill. Each workflow skill is short and tells the agent to search first.

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
| The core skill and the references an agent reads | `plugin/skills/northstar/` |
| The workflow skills | `plugin/skills/northstar-build/`, `northstar-refine/`, `northstar-finish/`, `northstar-review/` |
| The archetypes | `canon/archetypes.yaml` |
| Curated design data | `packages/data/json/` |
| The scanner | `packages/detector/` |
| DESIGN.md tools and the token generator | `packages/design-md/` |
