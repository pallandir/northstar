# @pallandir/northstar

MCP server that ingests real-time UI comments from the Northstar extension and
exposes them to your AI coding assistant. It speaks standard MCP, so it works
with any MCP-capable client; it has been tested with Claude Code.

It does two things in one process:

- Speaks MCP over stdio to your assistant (spawned automatically per session).
- Opens a localhost HTTP listener (7474, then 7475/7476) the browser extension
  posts comments to. The listener binds to `127.0.0.1` only and accepts requests
  solely from the extension (web-page origins and non-loopback hosts are
  rejected); payloads are validated against a strict schema.

Comments are stored in `.northstar/design-comments.md` and screenshots in
`.northstar/design-shots/`, relative to the working directory it is launched from.
The `.northstar/` folder is gitignored (the server also writes a `.gitignore`
inside it).

## Install

```bash
# Register from npm (no clone needed), e.g. with Claude Code:
claude mcp add northstar -- npx -y @pallandir/northstar
```

## Tools

The server exposes 6 tools. `list_comments` returns full per-comment detail, so
there is no separate per-comment fetch.

| Tool | Purpose |
| --- | --- |
| `list_comments(status?)` | List comments with full detail, optionally filtered by `open` / `resolved` / `wontfix`. |
| `resolve_comment(id, status)` | Set a single comment to `open` / `resolved` / `wontfix`. |
| `resolve_comments(resolutions[])` | Resolve or wontfix many comments in one call. |
| `defer_comment(id, reason, ...)` | Park a comment (`needs-plan` or `feedback`) and notify the toolbar. |
| `list_deferred()` | List deferred comments with their category and reason. |
| `clear_resolved()` | Remove every comment that is not open. |

There is no tool to start the work. When the developer clicks **Send to AI**, the
server types a one-line request into the terminal this process was launched from.

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
| `NORTHSTAR_ROOT` | `process.cwd()` | Where the store is written. |
| `NORTHSTAR_TERMINAL` | detected | Force a driver: `tmux`, `iterm`, `terminal-app`, or `none`. |
| `NORTHSTAR_INJECT` | `1` | Set to `0` to never type into the terminal. |

## Develop

```bash
npm run dev --workspace @pallandir/northstar     # tsup watch
npm run build --workspace @pallandir/northstar
```
