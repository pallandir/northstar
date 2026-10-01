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

Thirty four checks map one to one onto rules in the canon. See [the rule index](./canon.md) for every rule, its severity and whether it can be allowed. Examples: gradient text, thick coloured side borders, hard offset shadows, eyebrow labels, emoji used as icons, glass as decoration, `transition: all`, bounce easing, removed focus outlines, clickable divs, hand drawn inline SVG icons, hand rolled dialogs and font files.

Some rules cannot be checked from source. Contrast is checked from `DESIGN.md` tokens by `design_md_validate`. Target size, nested cards and grey text on colour need a rendered page and are left to the critique stage.

## Severity follows the mode

The same rule can be an error in one mode and quiet in another. Scroll hijacking is an error in a persuasive page and allowed in an experience page. Eyebrow labels are an error on a marketing page and a warning in an app.

## Allowing something on purpose

Rules that are not accessibility rules can be allowed, with a reason, in `DESIGN.md`:

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

Accessibility rules cannot be allowed. An allow entry for one is reported as an error by `design_md_validate` and ignored by the scanner.

## In the agent loop

For Claude Code, Codex and Gemini CLI, `northstar install` adds a hook that scans each file the agent edits and sends back up to five errors as feedback, so the agent fixes them in the same turn. OpenCode gets a small plugin that does the same. Cursor has no hook that can return feedback to the model, so there the agent calls `slop_scan` itself, guided by an always on rule. See [agents](./agents.md).

The hook only scans projects that opt in, meaning a `DESIGN.md` at the project root or a UI framework dependency (React, Next.js, Vue, Svelte, Angular, Solid, Astro and similar) in a `package.json` at or above the edited file. It skips test, spec, fixture and end to end paths. That keeps a user level install quiet in backend repositories. `northstar detect` and `slop_scan` are explicit calls and scan whatever you point them at.

The hook never fails an edit. On any error or unrecognised input it exits quietly.
