# Setting up your agent

One command registers the Northstar MCP server, installs the skills and adds the edit scan hook for every supported agent it finds on your machine:

```sh
npm install -g @pallandir/northstar
northstar install
```

The browser helper that `install` registers points at the installed package, so use a global install. For the design tools alone, `npx -y @pallandir/northstar install --no-host` works without one.

It prints a plan, asks before changing anything and backs up every file it overwrites. `--agent claude,codex` picks agents, `--scope project` writes into the current project instead of your home folder, `--dry-run` only shows the plan. `northstar doctor` checks the result and `northstar uninstall` removes exactly what install added. To try a local build, pass `--bin` with the path of `mcp/dist/cli.js`.

## What each agent gets

| Agent | MCP server | Skill | Edit hooks | Context file |
|---|---|---|---|---|
| Claude Code | yes | yes | a scan after edits | `CLAUDE.md` in project scope |
| Codex | yes | yes | a scan after edits, which Codex asks you to trust once | `AGENTS.md` |
| Cursor | yes | yes | none, Cursor has no hook that can return feedback | an always on rule in project scope |
| Gemini CLI | yes | yes | a scan after edits | `GEMINI.md` |
| OpenCode | yes | yes | a plugin that scans after edits | none |

Where an agent has no hook, the skill and the context file tell it to call `slop_scan` itself.

## The skills

Five skills are installed side by side: `northstar` (the core, with the method, rules and references), and four short workflow skills, `northstar-build`, `northstar-refine`, `northstar-finish` and `northstar-review`. The workflow skills hold only the steps and send the agent to the core for detail. Because they search the canon instead of loading it, they keep the context small. If other UI skills are installed, such as impeccable, taste-skill or ui-ux-pro-max, `northstar conflicts` lists them and `northstar conflicts --remove` moves them to a quarantine you can restore. Northstar covers the same ground, and several UI skills together give mixed advice.

## The design system

Writing `DESIGN.md` before UI code is a recommendation. No hook blocks an edit without it. The skill text and `northstar_context` report what is missing and which tool fixes it.

## Tools

Every tool is always available, and the canon says which ones each stage uses. The full list is in [the architecture](./architecture.md).

## Figma

Northstar ships no Figma connector. For a design system that lives in Figma, install the official Figma MCP server. The skill shows the install guide when the Figma tools are missing, and the same commands are in the canon reference `references/figma.md`.

## Browser comments

The extension reaches Northstar through the browser helper that `northstar install`
registers, so there is nothing to pair. **Send to AI** wakes any assistant that is
running `northstar listen`. In Claude Code, install the `northstar-live` mod once with
`/plugin install northstar-live --marketplace pallandir/northstar`. In any other
assistant, choose **Copy the line** in the toolbar and paste it, as described in the
[README](../README.md#step-3-start-your-agent-and-comment). Any assistant that can run a
shell command works.
