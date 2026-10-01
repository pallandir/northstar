# Setting up your agent

One command registers the Northstar MCP server, installs the skills and adds the edit hooks for every supported agent it finds on your machine:

```sh
npm install -g @pallandir/northstar
northstar install
```

The browser helper that `install` registers points at the installed package, so use a global install. For the design tools alone, `npx -y @pallandir/northstar install --no-host` works without one.

It prints a plan, asks before changing anything and backs up every file it overwrites. `--agent claude,codex` picks agents, `--scope project` writes into the current project instead of your home folder, `--dry-run` only shows the plan, and `--packs dynamic|all` chooses which tool packs start enabled. `northstar doctor` checks the result and `northstar uninstall` removes exactly what install added. To try a local build, pass `--bin` with the path of `mcp/dist/cli.js`.

## What each agent gets

| Agent | MCP server | Skill | Edit hooks | Context file |
|---|---|---|---|---|
| Claude Code | yes | yes | a DESIGN.md gate before UI edits and a scan after edits | `CLAUDE.md` in project scope |
| Codex | yes | yes | a scan after edits, which Codex asks you to trust once | `AGENTS.md` |
| Cursor | yes | yes | none, Cursor has no hook that can return feedback | an always on rule in project scope |
| Gemini CLI | yes | yes | a scan after edits | `GEMINI.md` |
| OpenCode | yes | yes | a plugin that scans after edits | none |

Where an agent has no hook, the skill and the context file tell it to call `slop_scan` itself.

## The skills

Five skills are installed side by side: `northstar` (the core, with the method, rules and references), and four short workflow skills, `northstar-build`, `northstar-refine`, `northstar-finish` and `northstar-review`. The workflow skills hold only the steps and send the agent to the core for detail. Because they search the canon instead of loading it, they keep the context small. If other UI skills are installed, such as impeccable, taste-skill or ui-ux-pro-max, `northstar conflicts` lists them and `northstar conflicts --remove` moves them to a quarantine you can restore. Northstar covers the same ground, and several UI skills together give mixed advice.

## The design gate

In Claude Code a pre edit hook blocks UI file edits until `DESIGN.md` exists, parses, has no placeholders and names a mode. The deny message says what is missing and which tool fixes it. Other agents rely on the skill text and `northstar_context`, which report the same gate. Setting `NORTHSTAR_GATE=off` opens the gate, and it is meant only for a user who asked to skip the design system.

## Tool packs

The tools are grouped into packs so that an agent only sees what the current stage needs. Core and comments are always on. The agent enables the others with `enable_packs`, or reaches any tool through `pack_call`. The full list is in [the architecture](./architecture.md).

## Figma

Northstar ships no Figma connector. For a design system that lives in Figma, install the official Figma MCP server. The skill shows the install guide when the Figma tools are missing, and the same commands are in the canon reference `references/figma.md`.

## Browser comments

The extension reaches Northstar through the browser helper that `northstar install`
registers, so there is nothing to pair. Start your agent with `northstar run <agent>`, or
run `northstar shell install` once so plain `claude` and `codex` do it for you. **Send to
AI** then writes one fixed line into that session and presses Enter, as described in the
[README](../README.md#step-3-start-your-agent-through-northstar-and-comment). Any CLI works,
register your own with `northstar agent add <id> <path>`.
