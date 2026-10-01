# @pallandir/northstar

The UI and UX orchestrator for AI coding agents. It ships the MCP server, a design
canon of twelve style archetypes, a token generator, a static detector, five skills
and an installer for Claude Code, Codex, Cursor, Gemini CLI and OpenCode, plus the
handoff for comments left with the Northstar browser extension. It speaks standard
MCP, so any MCP capable client can use it.

It does two things in one process:

- Speaks MCP over stdio to your assistant (spawned automatically per session).
- Opens a localhost HTTP listener (ports 7474 to 7476) the browser extension
  posts comments to. The listener binds to `127.0.0.1` only, accepts requests
  solely from a browser extension origin and needs the pairing token; payloads
  are validated against a strict schema and a bad field is rejected with its name.
  If every port is busy the server keeps serving MCP and reports the error in
  `northstar_context`.

Comments are stored in `.northstar/design-comments.json` with a write only
`design-comments.md` mirror, deferred entries in `.northstar/northstar-deferred.json`
and screenshots in `.northstar/design-shots/`, relative to the working directory it is
launched from. The `.northstar/` folder is gitignored (the server also writes a
`.gitignore` inside it).

## Install

```bash
npx -y @pallandir/northstar install
```

This finds the agents on your machine, prints a plan and asks before writing. Other
commands:

| Command | Purpose |
| --- | --- |
| `northstar install [--agent a,b] [--all] [--scope user\|project] [--packs all\|dynamic] [--bin path] [--no-gate] [--home dir] [--project dir] [--dry-run] [--yes]` | Register the server, install the five skills and the edit hooks. `--packs` defaults to `dynamic`. `--bin` points the server and hooks at a local build, `--no-gate` leaves out the design gate hook. |
| `northstar uninstall [--agent a,b] [--scope user\|project]` | Remove exactly what install added and restore what it replaced. |
| `northstar doctor` | Check installs, assets, hooks, the pairing token, ports, DESIGN.md and conflicts. |
| `northstar init [dir]` | Scaffold `DESIGN.md`, `PRODUCT.md` and `design/decisions.md` without overwriting. |
| `northstar detect [paths] [--diff] [--format text\|json\|sarif] [--mode m]` | Scan UI files, exit 1 on errors. |
| `northstar conflicts [--remove] [--restore stamp]` | Find overlapping UI skills (impeccable, ui-ux-pro-max, taste and similar) and quarantine them. |
| `northstar hook pre-edit\|post-edit --agent a` | The edit hook entry point. `pre-edit` is the design gate that denies UI edits until DESIGN.md is ready, `post-edit` scans the edited files. Hooks never block an edit on their own errors, they exit non zero with a message. |

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
runs the whole list, get and resolve flow. The design work is prompts too: `brief`,
`direct`, `system`, `compose`, `critique`, `polish`, `build`, `refine`, `finish`,
`adapt` and `modernise`. The canon is served as resources under `northstar://canon/`,
with a small map at `northstar://canon/index`.

### Design tools

| Tool | Pack | Purpose |
|---|---|---|
| `canon_find(query, kind?, stage?, limit?, budget?)` | core | Search reference sections, rules, archetypes and conflicts within a token budget. |
| `canon_read(id, full?)` | core | Read one section, or an outline for a topic. |
| `design_tokens_generate(archetype, mode, name, description, ...)` | system | Generate a validated `DESIGN.md` from an archetype, with an optional blend and brand colour. |
| `design_system_propose(product, mood?, mode?, archetype?, brand?)` | system | Draft a system from a short brief. |
| `ui_audit(paths?)` | detect | Count the values in existing UI, list drift and order the fixes. |

The other design tools are `design_md_init`, `design_md_normalize`, `design_md_validate`,
`design_md_export`, `design_search`, `design_get`, `resolve_library`, `resolve_font`,
`resolve_icon`, `slop_scan`, `explain_rule`, `critique_rubric` and `record_critique`.

There is no tool to start the work and no watch mode. When the developer clicks
**Send to AI**, the extension calls `POST /handoff` and the server wakes the agent
by one path. Claude Code gets a channel event, and needs to be started with
`claude --dangerously-load-development-channels server:northstar`. Codex and Gemini
get one fixed line typed into the terminal this process was launched from. The
server then waits up to 20 seconds for a `list_comments` call and reports whether it
came. There is no fallback.

## HTTP endpoints (for the extension)

Every non 2xx response is JSON `{ error, fix }`. The server creates a 32 byte random
token in `~/.northstar/token` (mode 0600) on first start. Every route except
`/health`, `/pair` and `/pair/confirm` needs it in the `x-northstar-token` header, and
requests must come from a `chrome-extension://` or `moz-extension://` origin on a
loopback host.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Open. Returns `{ ok, service: "northstar", protocol, version, root, startedAt, paired }`. |
| `GET` | `/pair` | Open. A page naming the project with one Allow button. |
| `POST` | `/pair/confirm` | Open, same origin only. Trades the page's single use nonce for the token. |
| `GET` | `/status` | Notices, agent readiness with its reason and fix, the open comment count, the last poll time and the last handoff outcome. |
| `GET` | `/state` | Version, stored comments, deferral notices, and agent readiness. |
| `GET` | `/comments?page=<pageKey>` | Stored comments for one page, so the extension shows synced pins. `page` is required. |
| `POST` | `/comments` | Ingest an array of drafts, each with a `cid`. Returns `{ ids, accepted, rejected }`. It never wakes the agent. |
| `POST` | `/handoff` | Wake the agent about the open comments. Waits for its first `list_comments` call and returns `{ delivered, agent, via, reason?, fix? }`. 400 when nothing is open, 409 while another send runs. |
| `POST` | `/owns` | Body `{ paths }` of up to 20 relative source paths. Returns `{ matches, depth }` so the extension can bind a page to the project that contains its files. Paths that are absolute, contain `..` or escape the root through a symlink are refused. |
| `POST` | `/comments/reopen` | Reopen a resolved comment with an optional note. |
| `POST` | `/notices/dismiss` | Clear a deferral notice from the toolbar. |
| `DELETE` | `/comments?page=<pageKey>` | Delete stored comments for a page, or every comment with `?all=true`. |

See [SECURITY.md](../SECURITY.md) for the pairing flow.

## Env

| Variable | Default | Meaning |
| --- | --- | --- |
| `NORTHSTAR_PORT` | 7474 | Preferred ingest port (then 7474 to 7476). |
| `NORTHSTAR_ROOT` | `process.cwd()` | Where the store is written and DESIGN.md is read. |
| `NORTHSTAR_PACKS` | `dynamic` | Starting tool packs: `dynamic`, `all`, or a comma list. |
| `NORTHSTAR_TERMINAL` | detected | Force a driver: `tmux`, `iterm`, `terminal-app`, `wezterm`, `kitty`, or `none`. |
| `NORTHSTAR_INJECT` | `1` | Set to `0` to never type into the terminal. |
| `NORTHSTAR_GATE` | on | Set to `off` to disable the design gate hook. |
| `NORTHSTAR_HOME` | the home directory | Parent of the `.northstar` folder that holds the pairing token. |

## Develop

```bash
npm run dev --workspace @pallandir/northstar     # tsup watch
npm run build --workspace @pallandir/northstar
```
