# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [2.4.0] - 2026-10-01

Northstar becomes a design engine. The first test of the framework produced a clean
pricing page that still looked like a default: Tailwind slate and blue, one flat
radius, no depth, no pressed states. This release changes what gets proposed, not
only what gets banned.

### Added

- **Archetypes.** Twelve style recipes in `canon/archetypes.yaml`: minimalist, soft,
  warm, precise, technical, dense data, editorial, swiss, brutalist, bold, playful and
  luxury. Each sets hue, neutral temperature, shape, density, motion feel, fonts, a
  depth model and layout moves. Two can be blended, and the secondary may lend its
  surfaces, type or motion but never the mode, density or accessibility floor.
- **Token generator.** `design_tokens_generate` builds a complete `DESIGN.md` from an
  archetype and an optional brand colour: a tinted OKLCH neutral ramp, accent and
  status colours, light and dark themes, layered shadows, radii that nest, spacing, a
  type scale with tracking and motion tokens. Contrast is solved for every pair, and
  a pair that cannot pass stops the run with a fix. A supplied brand colour is kept
  exactly as given when it passes contrast, and only derived, with a note saying why,
  when it does not. The accent stays out of the purple band.
- **Exports.** CSS, Tailwind and DTCG output now carries shadows, motion tokens and
  the dark theme.
- **Finish layer.** New references for finish and interaction, a rewritten motion
  reference with duration and easing values, `refine` as a full protocol, and
  `archetypes`. A new `finish` dimension in the critique rubric, with the weights
  rebalanced for every mode.
- **Eleven detector checks.** `100vh` for full height, a single black shadow, a
  button with a hover and no pressed state, ungated hover transforms, prices without
  tabular numerals, headings without balanced wrapping, huge `z-index` values, pale
  saturated borders, `ease-in`, `scale(0)` entrances and transitions over 300ms. The
  default palette rule now spots colours taken straight from the Tailwind defaults.
  All of them are warnings or notes. The canon has 68 rules and 13 resolved conflicts.
- **`ui_audit`.** Counts the colours, radii, shadows, sizes, spacing, z indexes and
  durations in existing code, lists the drift from `DESIGN.md` and orders the fixes.
- **Smart search.** `canon_find` and `canon_read` search 178 reference sections, the
  rules, archetypes and conflicts inside a token budget, with synonyms, typo
  correction and a boost for the current stage. A small index is served as
  `northstar://canon/index` and shipped as `references/INDEX.md`.
- **Skill family.** Four short workflow skills join the core skill:
  `northstar-build`, `northstar-refine`, `northstar-finish` and `northstar-review`.
  The new prompts are `build`, `refine` and `finish`.
- Attribution for make-interfaces-feel-better, Emil Kowalski's skills and the Vercel
  Web Interface Guidelines, all MIT, in `NOTICE`.

### Changed

- `design_system_propose` now picks an archetype from the brief and generates the
  tokens instead of seeding a draft from the first palette it finds.
- The core skill no longer lists every reference. It points to the index and to
  `canon_find`, which keeps the context small.
- `northstar install` writes five skill folders, and `doctor` and `uninstall` handle
  each one. `northstar conflicts` also finds taste, make-interfaces-feel-better and
  emil-design-eng style skills.
- The `NS-LAYOUT-VIEWPORT-HEIGHT` rule moved from advisory to a static check.
- The README is rewritten around the engine and the loop between engineers and
  designers.

## [2.3.0] - 2026-10-01

A production hardening release. It fixes Save, pins that leaked between pages and pins
that vanished on reload, makes every failure visible, and pairs the browser with the
server through a token.

### Breaking

- **The browser pairs with the server through a token.** The server creates a random
  secret at `~/.northstar/token` on first start. The toolbar shows **Connect** when it
  has no token or the server answers 401. One click opens a page served by your own
  server, **Allow** hands the token to the extension, and the tab closes. Every route
  except the health check and the pairing page now needs it. Every existing user
  connects once after upgrading.
- **Removed extension id pinning.** The `NORTHSTAR_EXTRA_ORIGINS` environment variable
  and the `--extension-id` option of `northstar install` are gone. Any
  `chrome-extension://` or `moz-extension://` origin is accepted once it has the
  token, so locally built extensions need no configuration.
- **Protocol 3.** `/health` reports `protocol: 3`, and the extension and the server
  refuse each other on a mismatch with a message naming the older side. Every comment
  must carry a `cid`, and `GET /comments` requires a `page` key. The legacy
  acceptance paths are removed.

### Fixed

- **Save now stores the comment.** The page probe could throw while answering
  synchronously, which left the save waiting forever. The probe is fixed and the save
  result is checked, so the toolbar says Saved or shows the error.
- **Pins stay on the page they belong to.** They are cleared when the URL changes and
  matched by a page key, so pins from one route no longer snap onto another in a
  single page app.
- **Pins survive a reload.** A tab that was on stays on after a reload. Loopback pages
  are restored without a click, and remote pages show that a click restores them.
- Send, the queued count and Delete all are scoped to the tab's own site.

### Changed

- **Failures are loud.** Fallbacks and swallowed errors were removed across the server,
  the detector, the installer and the extension. A rejected comment stays queued with
  its reason, a corrupt store stops with an error that names the file, a failing hook
  exits non zero with a message, and when every port is busy the server says so.
  Every HTTP error is JSON with an `error` sentence and a `fix` sentence.
- **Strict validation.** A bad field rejects the comment with a reason naming the
  field, with no stripping and no nulling.
- **The design canon gained taste-skill.** A one line design read before code, three
  taste dials for design variance, motion intensity and visual density, asked as one
  question and recorded in the `DESIGN.md` prose, soft, minimalist and brutalist
  direction archetypes, a redesign audit order, a pre flight checklist and dark mode
  parity. New rules cover dynamic viewport height, placeholder names and fake round
  statistics, and dark mode parity, and the cliche copy list grew. Scroll hijacking is
  informational in Experience mode so the opt in can be enforced. The canon has 57
  rules and 10 resolved conflicts, with attribution in `NOTICE`.
- **A Figma guide.** When the designer wants the system from Figma and the official
  Figma MCP tools are not installed, the agent stops and shows the install commands for
  Claude Code, Codex, Cursor and VS Code. With them, it reads the variables and passes
  them to `design_md_normalize`.
- The tool count in the docs is now 24 tools and 9 prompts, `docs/agents.md` exists,
  and the security, releasing, contributing and store texts describe the current model.

### Tooling

- `scripts/check-versions.mjs` fails when versions differ across the repo. CI and the
  npm publish workflow run it, and publishing also runs the typecheck, tests,
  `gen:check` and `check:pack` first.
- CI tests on Node 20 and 22 and builds the Chromium extension.
- Root `npm run dev` runs every watcher in parallel.
- Commit scopes now include `packages`, `protocol`, `integrations` and `scripts`.

## [2.2.0] - 2026-10-01

Northstar is now a UI design advisory framework for AI agents, with the browser
comment channel as its feedback loop. The extension and the comment tools are
unchanged.

### Added

- **The Northstar method and canon.** Six stages (brief, direction, system, compose,
  critique, polish), four modes, 53 rules and an arbitration order that settles the
  conflicts between impeccable, ui-ux-pro-max, frontend-design and top-design. The
  canon is distilled, not copied, with attribution in `NOTICE`.
- **A router skill and references that load on demand**, a read only critic agent,
  and prompts for each stage. The canon is also served as MCP resources.
- **Tool packs.** The core and comments packs are always on. Research, system,
  resolve, detect and critique are enabled per stage, with `tools/list_changed` and a
  `pack_call` fallback. New tools include `northstar_context`, `design_search`,
  `design_md_normalize`, `design_md_validate`, `design_md_export`,
  `design_system_propose`, `resolve_library`, `resolve_font`, `resolve_icon`,
  `slop_scan`, `explain_rule`, `critique_rubric` and `record_critique`.
- **DESIGN.md tooling.** Turn any freeform direction into a validated `DESIGN.md`,
  check WCAG contrast, and export to CSS variables, a Tailwind v4 theme or DTCG.
- **Curated design data** ported from ui-ux-pro-max with BM25 search, with rows that
  contradict the canon removed or annotated.
- **A static detector** with 34 checks, available as `northstar detect`, as the
  `slop_scan` tool and as an edit hook. It outputs text, JSON or SARIF.
- **`northstar install`, `uninstall` and `doctor`** for Claude Code, Codex, Cursor,
  Gemini CLI and OpenCode, with dry runs, backups and exact reversal.
- **`northstar conflicts`** finds overlapping design skills and moves them to a
  quarantine you can restore.
- **`northstar init`** scaffolds `DESIGN.md`, `PRODUCT.md` and `design/decisions.md`.
- **Design aware comment handoffs.** A comment now carries the relevant tokens,
  libraries, mode and rules, and the files an agent edits are scanned when it
  resolves the comment.

- **Agents now write DESIGN.md before any UI code.** The skill, the always on context
  snippet, the server instructions and every stage prompt say so, and
  `northstar_context` returns a `gate` field that stays closed until `DESIGN.md` exists,
  parses, has no placeholders and names a mode. In Claude Code a `PreToolUse` hook
  denies edits to UI source files (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro`, `.html`
  and CSS) in UI projects until the gate opens. Other agents are reminded after each
  edit. Test files, plain `.ts` and `.js`, the design documents themselves and non UI
  projects are never blocked. `NORTHSTAR_GATE=off` disables it for a session and
  `install --no-gate` leaves the hook out.
- **A deactivate button in the toolbar.** The power button at the end of the toolbar
  turns Northstar off for the tab and keeps your comments. It sits behind its own
  separator so it is not hit by accident next to Delete all comments.
- **Clearer tooltips on every toolbar control.** The pick toggle and the comments button
  say what the next click does, Send explains why it is disabled and counts what it
  will send, icon only buttons have accessible names, and the tooltips at either end of
  the toolbar no longer run off screen or get cut off near the top of the window.

### Changed

- **The project is now MIT licensed**, previously PolyForm Noncommercial. Versions
  published before this release keep the license they were published under.
- The server's always on instructions are about 90 words. The comment handling steps
  moved into the `resolve-comments` prompt.
- The MCP SDK requirement is `^1.29.0` and tools use `registerTool`.

### Fixed

- **Pressing Enter in the comment box now saves the comment.** It used to do nothing
  unless Cmd or Ctrl was held, so a typed comment was lost when the popover closed.
  Shift+Enter adds a new line, and the popover hint now says how to save.
- **The comment popover no longer runs off the right edge of the window.** Its padding
  was not counted in its width, so it overflowed by 32 pixels and could hide the Save
  button and the Colour tab near the edge.
- The server no longer exits when all of ports 7474 to 7476 are busy. It keeps
  serving MCP and logs that ingest is disabled.

## [2.1.0] - 2026-10-01

A new overlay and a tighter agent loop. **Send to AI** still starts all work, and
the assistant still sits idle until then: no watch mode and no polling.

### Added

- **A `resolve-comments` MCP prompt.** In Claude Code, `/mcp__northstar__resolve-comments`
  lists the open comments, fetches each one, implements it at the located place and
  resolves it with a note and the files it changed. The typed fallback now sends
  exactly that line to Claude Code. The server must be registered as `northstar`.
- **A `get_comment` tool that claims a comment.** An open comment becomes
  `in_progress` when fetched, so a repeated trigger finds nothing open and says so.
- **Optional Claude Code channel push.** The server declares the `claude/channel`
  capability and pushes the resolve request when the client supports it. If no
  `list_comments` or `get_comment` call follows within 8 seconds, the terminal
  handoff runs instead.
- **A "Where to look" list per comment.** Each comment now lists its locations in
  order of reliability, with suggested `rg` searches, and its text is fenced and
  labelled as data. The ingest schema accepts optional v2 fields: `schemaVersion`,
  `intent`, `locate`, `page` and `element`.
- **Per item results from `POST /comments`.** The reply carries `accepted`,
  `rejected` and `typed`, an optional per item `cid` makes retries idempotent, and
  the legacy `ids` field is still returned so a 2.0 extension keeps working.
- **Resolution records.** `resolve_comment` and `resolve_comments` accept a `note`
  and `files`, stored with the time of resolution.

### Changed

- **`list_comments` is compact by default.** It returns one line per open comment
  unless a status is given. Use `get_comment` for full detail.
- **Clicking the toolbar icon toggles the overlay.** The popup is gone.
- **Origin checks are stricter.** A `null` Origin is rejected, a missing Origin is
  allowed only for `GET /health`, and Chrome extension origins must be the published
  extension id or listed in `NORTHSTAR_EXTRA_ORIGINS`, comma separated. Any
  `moz-extension://` origin is still allowed.
- **Oversized or malformed values are trimmed instead of rejected.** Long text is
  truncated, array route params are joined and non finite numbers are dropped.
- **The release guide lists all seven version sites** and documents that pushing a
  `v*` tag submits to AMO and publishes to npm.

### Fixed

- **The AMO workflow never ran.** `publish-firefox.yml` had invalid indentation.
- **A corrupt `design-comments.json` was silently wiped.** It is now backed up to
  `design-comments.json.bak-<timestamp>`.
- **Screenshots were left behind** when comments were cleared. They are now deleted.
- **A stray backup file leaked into the AMO source archive.** It is untracked and
  ignored.

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
- **BREAKING: the repo splits into `mcp/` and `extensions/{core,chromium,firefox}`.**
  `mcp-server/` becomes `mcp/`. The extension's source lives once, in
  `extensions/core/`; `extensions/chromium/` and `extensions/firefox/` hold only a
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
