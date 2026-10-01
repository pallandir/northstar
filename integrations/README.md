# Integrations

Generated from the same plans that `northstar install` uses. Use these when you prefer to configure an agent by hand. Merge the content into the destination rather than replacing a file that already exists.

| Agent | File here | Project destination | User destination |
|---|---|---|---|
| claude | `claude/mcp.json` | `.mcp.json` | `not used at user scope` |
| claude | `claude/settings.json` | `.claude/settings.json` | `~/.claude/settings.json` |
| claude | `claude/northstar-critic.md` | `.claude/agents/northstar-critic.md` | `~/.claude/agents/northstar-critic.md` |
| claude | `claude/context.md` | `CLAUDE.md` | `not used at user scope` |
| claude | skill folder | `.claude/skills/northstar` | `~/.claude/skills/northstar` |
| codex | `codex/config.toml` | `.codex/config.toml` | `~/.codex/config.toml` |
| codex | `codex/hooks.json` | `.codex/hooks.json` | `~/.codex/hooks.json` |
| codex | `codex/context.md` | `AGENTS.md` | `~/.codex/AGENTS.md` |
| codex | skill folder | `.agents/skills/northstar` | `~/.agents/skills/northstar` |
| cursor | `cursor/mcp.json` | `.cursor/mcp.json` | `~/.cursor/mcp.json` |
| cursor | `cursor/northstar.mdc` | `.cursor/rules/northstar.mdc` | `not used at user scope` |
| cursor | skill folder | `.agents/skills/northstar` | `~/.agents/skills/northstar` |
| gemini | `gemini/settings.json` | `.gemini/settings.json` | `~/.gemini/settings.json` |
| gemini | `gemini/context.md` | `GEMINI.md` | `~/.gemini/GEMINI.md` |
| gemini | skill folder | `.agents/skills/northstar` | `~/.agents/skills/northstar` |
| opencode | `opencode/opencode.json` | `opencode.json` | `~/.config/opencode/opencode.json` |
| opencode | `opencode/northstar.ts` | `.opencode/plugins/northstar.ts` | `~/.config/opencode/plugins/northstar.ts` |
| opencode | `opencode/context.md` | `AGENTS.md` | `~/.config/opencode/AGENTS.md` |
| opencode | skill folder | `.opencode/skills/northstar` | `~/.config/opencode/skills/northstar` |

Claude Code registers the server with its own cli at user scope: `claude mcp add --env NORTHSTAR_PACKS=all --transport stdio --scope user northstar -- npx -y @pallandir/northstar`.

The skill folders are `plugin/skills/northstar` and the `plugin/skills/northstar-*` folders in this repository, copy each one next to the destination shown.
