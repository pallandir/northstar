# @pallandir/northstar

The UI and UX orchestrator for AI coding agents. It ships the MCP server, a design
canon of twelve style archetypes, a token generator, a static detector, five skills
and an installer for Claude Code, Codex, Cursor, Gemini CLI and OpenCode, plus the
handoff for comments left with the Northstar browser extension. It speaks standard
MCP, so any MCP capable client can use it.

It has three parts:

- The MCP server, which speaks MCP over stdio to your assistant (spawned
  automatically per session) and tells the daemon when the assistant read the comments
  or parked one.
- A small daemon (`northstar daemon`, started on demand) on a Unix socket only your
  user can open. It keeps the running sessions, routes a send to the right one and
  reads and writes the comment store. Payloads are validated against a strict schema
  and a bad field is rejected with its name.
- A native messaging host (`northstar native-host`) that Chrome and Firefox start for
  the extension. It answers only the Northstar extension and forwards a fixed list of
  actions to the daemon. There is no local web server and no port.

Comments are stored in `.northstar/design-comments.json` with a write only
`design-comments.md` mirror, deferred entries in `.northstar/northstar-deferred.json`
and screenshots in `.northstar/design-shots/`, relative to the working directory it is
launched from. The `.northstar/` folder is gitignored (the server also writes a
`.gitignore` inside it).

## Install

```bash
npm install -g @pallandir/northstar
northstar install
```

This finds the agents on your machine, registers the browser helper for Chrome and
Firefox, prints a plan and asks before writing. The browser helper points at the
installed package, so use a global install rather than `npx` for it. Other commands:

| Command | Purpose |
| --- | --- |
| `northstar install [--agent a,b] [--all] [--scope user\|project] [--packs all\|dynamic] [--bin path] [--no-gate] [--no-host] [--allow-extension id] [--home dir] [--project dir] [--dry-run] [--yes]` | Register the server, install the five skills and the edit hooks. `--packs` defaults to `dynamic`. `--bin` points the server and hooks at a local build, `--no-gate` leaves out the design gate hook. |
| `northstar uninstall [--agent a,b] [--scope user\|project]` | Remove exactly what install added and restore what it replaced, including the browser helper once no agent is left. |
| `northstar doctor` | Check installs, assets, hooks, the browser helper, the pseudo terminal module, the daemon, the shell integration, DESIGN.md and conflicts. |
| `northstar run <agent> [args]` | Start an agent in a session Northstar owns, so Send to AI can write into it. Any terminal program works. |
| `northstar sessions` | List the running sessions. |
| `northstar agent [list\|add <id> <path>]` | List the known agents, or register your own, optionally with `--quick-run "-p {{prompt}}"`. |
| `northstar shell install\|uninstall [--shell zsh\|bash\|fish]` | Add or remove shell functions so plain `claude` and `codex` start through `run`. |
| `northstar config [set preferred-agent <id> \| set template <id> \| map <site> <dir> \| unmap <site>]` | Show or change the settings in `~/.northstar/config.yaml`. |
| `northstar daemon [stop\|status]` | Run the daemon in the foreground, stop it, or show its status. |
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
**Send to AI**, the extension sends `session.send` through the native host and the
daemon has the session write one fixed line, chosen from six templates, into the
assistant's pseudo terminal and press Enter. The daemon then waits up to 20 seconds for
a `list_comments` call and reports whether it came. There is no push and no channel, and
the server declares no experimental capability.

## Native messaging actions

Every message is a length prefixed JSON frame `{ version, id, action, params }` and every
answer is `{ version, id, ok, result }` or `{ version, id, ok: false, code, error, fix }`.
Anything outside this list is refused with `UNSUPPORTED_ACTION`, and a frame has no
field that carries a command.

| Action | Purpose |
| --- | --- |
| `system.info` | Version, protocol, process id and start time of the daemon. |
| `agent.list` | The built in and custom agents, whether each is installed and whether it can quick run. |
| `session.list` | The running sessions with agent, folder, process id and last activity. |
| `session.send` | `{ root, template, sessionId? }`. Route to a session and write the fixed line. Returns the handoff outcome, or `NO_SESSION`, `PICK_SESSION`, `SESSION_NOT_FOUND`, `BLOCKED`. |
| `quickrun.execute` | `{ root, agent, template }`. Start an installed agent once with the fixed line, only when no session runs in the project. |
| `project.list` / `project.resolve` | The known project folders, and which of them owns a set of source paths or a mapped site. |
| `status.get` | Notices, session readiness with its reason and fix, the open comment count, the last poll and the last handoff outcome. |
| `comments.list` | Stored comments for one page, `page` is required. |
| `comments.add` | Ingest an array of drafts, each with a `cid`. Returns `{ ids, accepted, rejected }`. It never writes to the assistant. |
| `comments.clear` | Delete the comments of a page, or all of them with `all: true`. |
| `comments.reopen` | Reopen a resolved comment with an optional note. |
| `notices.dismiss` | Clear a deferral notice from the toolbar. |
| `config.get` / `config.set` | Read or change the preferred agent, the default template and the site mappings. |

Replies are kept under 900 KB and requests under 16 MB. See
[SECURITY.md](../SECURITY.md) for the threat model.

## Env

| Variable | Default | Meaning |
| --- | --- | --- |
| `NORTHSTAR_ROOT` | `process.cwd()` | Where the store is written and DESIGN.md is read. |
| `NORTHSTAR_PACKS` | `dynamic` | Starting tool packs: `dynamic`, `all`, or a comma list. |
| `NORTHSTAR_GATE` | on | Set to `off` to disable the design gate hook. |
| `NORTHSTAR_HOME` | the home directory | Parent of the `.northstar` folder that holds the config, the session state, the logs and the daemon socket. Keep it short, Unix sockets allow about 100 characters. |

## Develop

```bash
npm run dev --workspace @pallandir/northstar     # tsup watch
npm run build --workspace @pallandir/northstar
```
