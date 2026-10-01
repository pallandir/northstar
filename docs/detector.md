# The detector

The detector scans UI source for the generic patterns and library first violations that mark AI generated interfaces. It is static, needs no API key and runs in milliseconds. It is the same engine behind the `slop_scan` tool, the agent hooks and the command line.

## Running it

```sh
npx -y @pallandir/northstar detect src
npx -y @pallandir/northstar detect --diff
npx -y @pallandir/northstar detect src --format sarif > northstar.sarif
```

It exits with 1 when any error is found, so it works as a CI gate. Formats are `text`, `json` and `sarif`, and SARIF uploads to GitHub code scanning. `--mode` overrides the mode from `DESIGN.md`.

It reads `.tsx`, `.jsx`, `.ts`, `.js`, `.vue`, `.svelte`, `.astro`, `.html` and CSS files, skipping `node_modules`, build output and minified files.

## What it checks

Forty five checks map one to one onto rules in the canon. See [the rule index](./canon.md) for every rule, its severity and whether it can be allowed. Examples: gradient text, thick coloured side borders, hard offset shadows, eyebrow labels, emoji used as icons, glass as decoration, `transition: all`, bounce easing, removed focus outlines, clickable divs, hand drawn inline SVG icons, hand rolled dialogs and font files. The finish rules look for what makes a screen feel unfinished: `100vh` for full height, a single pure black shadow, a button with a hover state and no pressed state, hover transforms that are not limited to devices that can hover, prices without tabular numerals, headings without balanced wrapping, huge `z-index` values, pale saturated borders, `ease-in`, entrances from `scale(0)`, interface transitions over 300ms and a palette taken straight from the Tailwind defaults. These ship as warnings or notes, never as accessibility failures.

Some rules cannot be checked from source. Contrast is checked from `DESIGN.md` tokens by `design_md_validate`. Target size, nested cards and grey text on colour need a rendered page and are left to the critique stage.

## Auditing existing code

`ui_audit` goes beyond findings. It counts the distinct colours, radii, shadows, font sizes, font families, spacing values, z indexes and durations in the code, reports how much colour goes through tokens, lists values that are not in `DESIGN.md`, and says which kinds of finding to fix first. Twenty three greys and seven radii mean the system is missing, which is a different fix from changing a colour. It is the first step of a refine pass.

## Severity follows the mode

The same rule can be an error in one mode and quiet in another. Scroll hijacking is an error in a persuasive page and only informational in an experience page, where the opt in is an allow entry. Eyebrow labels are an error on a marketing page and a warning in an app.

## Allowing something on purpose

Rules can be allowed, with a reason, in `DESIGN.md`, unless the canon marks them not allowable. Those are the accessibility rules and the 360px responsive floor:

```yaml
northstar:
  mode: persuade
  allow:
    - { rule: NS-SLOP-GRADIENT-TEXT, reason: brand wordmark, scope: "src/brand/**" }
  ignore: ["legacy/**"]
```

Or inline, on the same line or the line above:

```tsx
{/* northstar-allow NS-SLOP-GRADIENT-TEXT: brand wordmark */}
```

A rule marked not allowable cannot be allowed. An allow entry for one is reported as an error by `design_md_validate` and ignored by the scanner.

## In the agent loop

For Claude Code, Codex and Gemini CLI, `northstar install` adds a hook that scans each file the agent edits and sends back up to five errors as feedback, so the agent fixes them in the same turn. OpenCode gets a small plugin that does the same. Cursor has no hook that can return feedback to the model, so there the agent calls `slop_scan` itself, guided by an always on rule. See [agents](./agents.md).

The hook only scans projects that opt in, meaning a `DESIGN.md` at the project root or a UI framework dependency (React, Next.js, Vue, Svelte, Angular, Solid, Astro and similar) in a `package.json` at or above the edited file. It skips test, spec, fixture and end to end paths. That keeps a user level install quiet in backend repositories. `northstar detect` and `slop_scan` are explicit calls and scan whatever you point them at.

The hook never fails an edit. On any error or unrecognised input it exits quietly.
