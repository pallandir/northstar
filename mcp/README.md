# @pallandir/northstar

A UI design advisory framework for AI coding agents. It ships the MCP server, the
design canon, a static detector and an installer for Claude Code, Codex, Cursor,
Gemini CLI and OpenCode, plus the handoff for comments left with the Northstar
browser extension. It speaks standard MCP, so any MCP capable client can use it.

It does two things in one process:

- Speaks MCP over stdio to your assistant (spawned automatically per session).
- Opens a localhost HTTP listener (7474, then 7475/7476) the browser extension
  posts comments to. The listener binds to `127.0.0.1` only and accepts requests
  solely from the extension (web-page origins and non-loopback hosts are
  rejected); payloads are validated against a strict schema. If every port is
  busy the server keeps serving MCP and logs that ingest is disabled.

Comments are stored in `.northstar/design-comments.md` and screenshots in
`.northstar/design-shots/`, relative to the working directory it is launched from.
The `.northstar/` folder is gitignored (the server also writes a `.gitignore`
inside it).

## Install

```bash
npx -y @pallandir/northstar install
```

This finds the agents on your machine, prints a plan and asks before writing. Other
commands:

| Command | Purpose |
| --- | --- |
| `northstar install [--agent a,b] [--all] [--scope user\|project] [--packs all\|dynamic] [--dry-run] [--yes]` | Register the server, install the skill and the edit hook. |
| `northstar uninstall [--agent a,b]` | Remove exactly what install added. |
| `northstar doctor` | Check installs, assets, hooks, ports, DESIGN.md and conflicts. |
| `northstar init [dir]` | Scaffold `DESIGN.md`, `PRODUCT.md` and `design/decisions.md` without overwriting. |
| `northstar detect [paths] [--diff] [--format text\|json\|sarif] [--mode m]` | Scan UI files, exit 1 on errors. |
| `northstar conflicts [--remove] [--restore stamp]` | Find overlapping design skills and quarantine them. |
| `northstar hook post-edit --agent a` | The edit hook entry point, never fails an edit. |

To register by hand with Claude Code instead:

```bash
claude mcp add northstar -- npx -y @pallandir/northstar
```

## Tools

The server must be registered under the name `northstar`. Tools are grouped into
packs. Core and comments are always on, the others are enabled with `enable_packs`
or reached through `pack_call`. `NORTHSTAR_PACKS` sets the starting packs: `dynamic`
for core and comments, `all`, or a comma separated list. See
[architecture](../docs/architecture.md) for the full list of packs and tools.

### Comment tools

| Tool | Purpose |
| --- | --- |
| `list_comments(status?)` | Compact summaries, open comments only unless a status is given. |
| `get_comment(id)` | Claim a comment (`open` becomes `in_progress`) and return full detail with an ordered "Where to look" list. |
| `resolve_comment(id, status, note?, files?)` | Set a single comment to `open` / `resolved` / `wontfix`, recording a note and the files changed. |
| `resolve_comments(resolutions[])` | Resolve or wontfix many comments in one call. |
| `defer_comment(id, reason, ...)` | Park a comment (`needs-plan` or `feedback`) and notify the toolbar. |
| `list_deferred()` | List deferred comments with their category and reason. |
| `clear_resolved()` | Remove every resolved and wontfix comment. |

The `resolve-comments` prompt (`/mcp__northstar__resolve-comments` in Claude Code)
runs the whole list, get and resolve flow. The design stages are prompts too: `brief`,
`direct`, `system`, `compose`, `critique`, `polish`, `adapt` and `modernise`. The canon
is served as resources under `northstar://canon/`.

There is no tool to start the work and no watch mode. When the developer clicks
**Send to AI**, the server types the prompt into the terminal this process was
launched from. With `claude --channels` it pushes a channel event first and types
only if no agent call follows within 8 seconds.

## HTTP endpoints (for the extension)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Port discovery probe; returns `{ ok, service: "northstar", root, terminal }`. |
| `GET` | `/state` | Version, stored comments, deferral notices, and terminal availability. |
| `GET` | `/comments` | List stored comments (lets the extension show synced pins). |
| `POST` | `/comments` | Ingest a batch of comments, then announce it in the terminal. Returns `{ ids, typed, reason? }`. |
| `POST` | `/comments/reopen` | Reopen a resolved comment with an optional note. |
| `POST` | `/notices/dismiss` | Clear a deferral notice from the toolbar. |
| `DELETE` | `/comments?url=<page>` | Delete stored comments for a page (omit `url` for `?all=true`). |

Every route is loopback-only and rejects any `Origin` that is not a browser
extension. There is no bearer token; see [SECURITY.md](../SECURITY.md).

## Env

| Variable | Default | Meaning |
| --- | --- | --- |
| `NORTHSTAR_PORT` | 7474 | Preferred ingest port (falls back to 7475/7476). |
| `NORTHSTAR_ROOT` | `process.cwd()` | Where the store is written and DESIGN.md is read. |
| `NORTHSTAR_PACKS` | `dynamic` | Starting tool packs: `dynamic`, `all`, or a comma list. |
| `NORTHSTAR_TERMINAL` | detected | Force a driver: `tmux`, `iterm`, `terminal-app`, or `none`. |
| `NORTHSTAR_INJECT` | `1` | Set to `0` to never type into the terminal. |

## Develop

```bash
npm run dev --workspace @pallandir/northstar     # tsup watch
npm run build --workspace @pallandir/northstar
```
