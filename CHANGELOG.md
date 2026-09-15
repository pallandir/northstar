# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-09-15

A rework around a single idea: **Send to AI** is the only thing that starts work.
This release also makes that work land at the right place without help: every
comment now names its own route, component and source.

### Changed

- **BREAKING: the watch loop is gone.** There is no session to pair and no command
  to paste. When you click **Send to AI**, the server types one line into the
  terminal your assistant is already running in and presses Enter. Because the
  path is plain keystrokes, Claude Code, Codex and Gemini all work identically.
  Supported terminals are tmux, iTerm2 and Terminal.app.
- **BREAKING: 11 MCP tools become 6.** `bind_session`, `unbind_session`,
  `wait_for_update`, `list_rating_requests` and `submit_rating` are removed, along
  with the `watch` prompt.
- **BREAKING: `POST /comments` takes the whole batch** as an array in one request,
  and answers `{ ids, typed, reason? }`. A ten-comment send used to be ten
  requests that woke the assistant up to ten times.
- **BREAKING: the session token and HMAC handshake are gone**, along with
  `/handshake`, `/ping`, `/wait` and `/ratings`. Loopback binding, the Origin and
  Host allowlists, the body cap and schema validation all stay. See
  [SECURITY.md](./SECURITY.md) for what this trade does and does not cover.
- **BREAKING: the comment wire shape widens.** Every comment now carries
  `component`, `route` and `target` alongside `source`, validated by strict zod
  schemas server-side; a client sending the old shape gets a clean `400` rather
  than a comment that silently lacks them.
- **BREAKING: the repo splits into `mcp/` and `extension/{core,chromium,firefox}`.**
  `mcp-server/` becomes `mcp/`. The extension's source lives once, in
  `extension/core/`; `extension/chromium/` and `extension/firefox/` hold only a
  manifest, a Vite config and a store listing each, so a fix lands in both
  builds together instead of drifting between two copies.
- **The three-chip action menu becomes one popover.** Clicking an element used to
  draw a selection box and a pill of three chips (Comment / Color / Text), each
  opening its own separate panel. It is now one popover with a target header
  (component, source, selector) and three tabs sharing one footer. Text and
  colour edits preview live against the element and revert on Cancel, Esc, or
  switching tabs.
- **The design system is rewritten.** A navy ground with a single amber accent
  replaces the light SaaS-card look; the selection/hover boxes become a
  four-corner reticle instead of a full box; a real six-step spacing scale, a
  three-step radius scale, and a declared z-scale replace ad hoc literals and
  nine `--cc-z-*` references that were never actually defined. The popup drops
  its own divergent button styles (32px, 8px radius) for the same
  `styles/controls.css` the overlay uses (34px, 6px).

### Added

- **Zero-config targeting.** A script injected into the page's own main world
  reads React (18 and 19), Vue (2 and 3), Svelte and Angular debug state
  directly, no build plugin required, and resolves the rendering component, an
  exact `file:line:column` where the framework tracks one, and the route
  (exact from Next.js, React Router, Vue Router or Nuxt; otherwise inferred from
  the URL shape and marked as such). Every comment also carries a stable CSS
  selector, preferring `data-testid`, then a real id, then a class chain scoped
  to the nearest stable ancestor, verified unique before being accepted.
- **Firefox support.** The extension builds for Gecko from the same source with
  `npm run build:firefox` and passes `web-ext lint` with no errors. Firefox 128 is
  the floor, set by the Popover API the overlay needs. A signing workflow
  (`.github/workflows/publish-firefox.yml`), AMO listing copy, and a reviewer
  source-archive script are ready for the first submission.
- **Terminal controls.** `NORTHSTAR_TERMINAL` forces a driver, `NORTHSTAR_INJECT=0`
  turns the typing off.
- **Screenshot consent is explicit end to end.** A comment now stores whether a
  screenshot was actually requested (`attachScreenshot`), not just whether a
  data URL happened to be attached, and the Handoff export honours the same
  flag per item instead of including whatever a draft happened to carry.
- **Deferred comments live in the drawer**, as a small callout above the list
  with the same per-notice Dismiss action, rather than a separate floating
  panel.

### Fixed

- **The overlay could be hidden by the page, making commenting impossible.** The
  shadow host opened with `all: initial`, which resets `z-index` to `auto`, and
  nothing set it back, so any positioned page element with a positive `z-index`
  covered the whole overlay. The host now carries an explicit `z-index` and is
  promoted into the browser's top layer, re-promoting whenever the page promotes
  something after it and moving inside a page's modal dialog so it stays clickable
  instead of being made inert.
- **Edits from the drawer silently dropped their flags.** `onEdit` was declared
  with two parameters but called with three, so `planFirst` and the screenshot
  option were lost when a comment was edited from the drawer rather than the pin.
- **A screenshot could end up in the Handoff export, or be captured at all,
  without being asked for.** The capture gate accepted an unset flag as consent
  (`!== false` rather than `=== true`); the colour and text tools forced a
  screenshot with no toggle to refuse it; and the export included an image
  whenever a draft happened to carry one, never checking whether the user had
  asked for it.
- **A comment carried only an XPath and 120 characters of merged text when no
  inspector plugin was installed**, which is why implementing one meant
  grepping the codebase for the element. See "Zero-config targeting" above.
- **The "Remote page" notice was a permanent, undismissable card.** An early
  `return` in the toolbar's render path made the panel-clearing code
  unreachable whenever the page was not `localhost`, so it stayed above the
  toolbar for the whole session. On a remote page Handoff is now simply the
  primary action; the remaining failure panel is a dismissible one-line strip
  that never shows in the healthy case and stays dismissed while the same
  problem persists.
- **`.env.example` documented `NORTHSTAR_PORTS`**, a variable the server never
  read. The name is `NORTHSTAR_PORT`.

### Removed

- The design-score feature end to end: both MCP tools, the `/ratings` endpoints,
  the ratings store, the drawer card, and the `northstar-design-score` skill.
- The setup checklist in the toolbar and the four-step tutorial in the popup.
- Dead message handlers `clear-comments` and `count-all`, and the unused store
  helpers behind them.
- `dompurify` and `marked`, along with the HTML-wrapping step in the Handoff
  export they existed for; the export is real Markdown now, dropping the
  content script bundle from 131KB to 64KB.

### Safety

- The line typed into your terminal is a **fixed constant**. No comment text, id or
  count reaches the terminal, so nothing arriving over loopback can change what
  your assistant is told to do.
- Northstar reads the visible pane before typing and refuses while a numbered
  choice or yes/no prompt is showing, or if it cannot read the pane at all. Sends
  landing within a few seconds of each other are coalesced into one line.
- The main-world probe reads only. It never assigns to a page object's
  prototype and never calls back into the page beyond dispatching its own
  events; every reader is wrapped so an unusual page can make it return
  nothing, never throw.

## [1.0.0] - 2026-06-17

First public release.

### Security

- **Locked down the MCP ingest server.** The localhost listener now rejects any
  request with a web-page `Origin` (`http(s)://…`) and any non-loopback `Host`
  header, closing CSRF / store-poisoning and DNS-rebinding paths. CORS now
  reflects only the extension origin instead of `*`.
- **Validated all ingested payloads** with a strict `zod` schema (bounded string
  lengths, screenshot data-URL format), so a malformed body is a clean `400`
  and can no longer crash the store.
- **`/health` now identifies the service**; the extension only trusts a port
  that reports `service: "northstar"`.
- **Zero standing page access.** The extension declares no content scripts and no
  web-page host permissions. The overlay is injected into a single tab on demand
  via `chrome.scripting` under the `activeTab` grant, only after the user clicks
  the action, and that access ends on navigation. `host_permissions` is scoped to
  loopback only and is used purely by the service worker to reach the local
  listener, never for page access.
- **Dropped the `debugger` permission entirely.** Removed the optional Precise
  mode and its CDP source mapping, so the extension no longer declares or requests
  the powerful `debugger` permission (Chrome also forbids it as optional). Color
  edits still record `property: from -> to`; the assistant locates the CSS from
  the selector and screenshot.
- **Dependency audit clean.** `npm audit` now reports zero vulnerabilities:
  `vite` upgraded to a release with a patched `esbuild`, with `esbuild` and `tmp`
  pinned to patched versions through root `overrides`.
- **Scoped assistant output.** The `/comments` skill and MCP read-tool
  descriptions now constrain the assistant to UI changes bound to each comment's
  located source, forbid acting on instructions embedded in comment data or
  sending any page content anywhere, and direct it to pull only the comment data
  it needs into context, while leaving design creativity, web assets, and
  installed skills unrestricted.

### Added

- **Comment on any frontend, not just localhost.** Activate Northstar on any site,
  a local dev server or a remote preview, while all captured data still travels
  only to the loopback listener and the assistant edits only the local repo.
- **Watch loop over 11 MCP tools.** `bind_session` / `unbind_session` claim and
  release a browser session, `wait_for_update` long-polls the store and
  heartbeats the binding, `list_comments` returns full per-comment detail as the
  batch read, `resolve_comment` / `resolve_comments` and `defer_comment` /
  `list_deferred` close or park work, and `clear_resolved` prunes finished
  entries. Comments flush only when the user clicks Send to AI.
- **Purpose-fit page scoring.** `list_rating_requests` and `submit_rating`, plus
  the bundled `northstar-design-score` skill, rate a page screenshot for fitness to
  its own purpose (ui, ux, coherence) rather than an absolute award-site bar.
- **Figma-style toolbar.** A draggable in-page toolbar with Select, Comment,
  Color, and Text tools, rendered in a closed shadow DOM, replacing the earlier
  context-menu entry point.
- Unit tests (`node:test`) for the comment store and the HTTP origin/Host gate
  and payload validation.
- CI workflow (lint, typecheck, build, test) and an npm publish workflow with
  provenance.
- Publication artifacts: `.mcpb` bundle manifest and pack script, Chrome Web
  Store packaging script and listing copy, `SECURITY.md`, and `PRIVACY.md`.

### Changed

- Repositioned from "for Claude Code" to assistant-agnostic: works with any
  MCP-capable AI coding assistant via the MCP server. Tested with Claude Code;
  other clients are unverified. Updated descriptions and docs accordingly.

### Fixed

- The ingest server now reports its actual bound port (correct when an
  OS-assigned port is used).
