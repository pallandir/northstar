# Security

Northstar is a developer tool that runs entirely on your machine. You can leave
comments on any running frontend, local or a remote preview, but everything you
capture stays local: the only thing that crosses a trust boundary is a comment
you explicitly created, and it only ever travels to a helper owned by your own user
and to an assistant session that Northstar itself started.

## Threat model

- **Processing stays local.** There is no network listener. The extension reaches
  Northstar through Chrome and Firefox Native Messaging, the helper reaches the
  daemon through a Unix socket in a directory only your user can open (mode 0700,
  socket 0600). No comment, screenshot, or source path leaves your machine, and
  there is no remote backend.
- **No standing access to any page.** The extension declares no content scripts
  and no web-page host permissions, so it runs on no site by default. The overlay
  is injected only into a tab you activate by clicking the toolbar button, under
  the `activeTab` grant. The context menu entry and the keyboard shortcut grant
  `activeTab` for the page they were used on, nothing more. Visiting a page never
  gives the extension a foothold.
- **The main-world probe reads only.** Resolving a component and a route requires
  reading state a page's own framework attaches to its DOM nodes, which an
  isolated-world content script cannot see. Northstar injects a second script
  into the page's main world for this, on the same activation as the overlay.
  That script never writes to a page object's prototype, never calls back into
  the page beyond dispatching its own events, and has no extension API access
  from that world; every reader is wrapped so an unusual page can make it return
  nothing, never throw into that page's own execution.
- **The extension makes no network request.** Its host permissions are `localhost`,
  `127.0.0.1`, and `*.localhost`, used only so the overlay can run on a local dev
  server you activate. It talks to Northstar only through Native Messaging.
- **The helper answers only the Northstar extension.** The native host manifest
  allows exactly one Chrome extension origin and one Firefox extension id, and the
  host checks the caller it was started with again before it reads a message. An
  unpacked build is allowed only when you pass its id to
  `northstar install --allow-extension`. A web page cannot reach a Native Messaging
  host at all.
- **Every message is checked against a fixed list.** The host accepts a versioned
  envelope with a strict schema, a fixed set of actions (`system.info`, `agent.list`,
  `session.list`, `session.send`, `quickrun.execute`, the comment, project, status and
  config actions), at most 16 MB in and about 900 KB out. An unknown action, an unknown
  key, a malformed frame or a wrong version is refused with a reason and a fix. The
  protocol has no field that carries a shell string or a command, and browser input is
  never evaluated or passed to a shell. A project root the daemon has not seen is
  refused, so a message cannot make Northstar create files in an arbitrary folder.
  Every comment is validated against a strict schema with bounded field sizes.
- **Comments are untrusted input to the assistant.** The MCP read tools treat
  every comment's text and selector as *data describing a change*, never as
  instructions. The assistant acts only on the design intent, binds edits to the
  located source, stays within UI changes, and sends no page content or comment
  data anywhere.
- **Northstar can only write into sessions it started.** `northstar run` starts the
  assistant in a pseudo terminal that Northstar owns, and that terminal is the only
  place a send can write. Northstar does not use `tmux`, AppleScript, accessibility
  permissions or any terminal automation, so it cannot type into another window, and
  there is nothing to grant. There is also no channel and no development flag.
- **What Northstar writes is a fixed constant.** A send makes the session write one
  line chosen from six templates compiled into the package (resolve, implement,
  explain, fix, review, add to task). The wrapper re-checks that the line is exactly
  one of them, printable ASCII, before it writes. No comment text, selected text, page
  URL, page title, id or count is ever written. The assistant reads all of that through
  the MCP tools, as data.
- **Northstar will not answer a prompt for you.** The wrapper keeps a rendered copy
  of the terminal screen. It refuses when a numbered choice or a yes or no question is
  showing, when there is text in the assistant's input, when you typed in the last
  moments, or when the output never goes quiet. Your own keystrokes are held while a
  line is written and released after, so they cannot interleave with it. Each refusal
  is shown in the toolbar with the reason and the fix.
- **Quick run is an explicit choice with a fixed argument list.** It is offered only
  when no session runs in the project, it starts only an agent you pick, and it runs
  the agent with an argument array whose prompt is one of the fixed lines. It never
  goes through a shell.
- **Copy the line is explicit too.** It copies the same fixed line to the clipboard
  when you press it.
- **Least-privilege extension.** The extension requests `activeTab`, `scripting`,
  `storage`, `unlimitedStorage`, `nativeMessaging` and `contextMenus`, plus the
  loopback host permissions above. It requests no `debugger` permission and holds no
  capability to drive a page over the DevTools protocol.
- **Logs hold no content.** `~/.northstar/logs/` records events, session ids, agent
  names, byte counts and durations. It never holds comment text, selected text or a
  prompt.
- **No remote code, no telemetry.** The extension and server build to static
  assets. The published npm package ships only `dist/`. There is no analytics,
  tracking, or external network call.

## What this does not defend against

- **Any process running as you can open the daemon socket.** Such a process could
  already read and write `.northstar/` directly, so the store is not a new target.
  The escalation that would matter, making your assistant follow attacker written
  instructions, is closed by the fixed lines and by the rule that comment text is
  data. It could, however, ask the daemon to send the existing open comments to a
  session, or to clear them.
- **The browser enforces which extension may start the helper.** Northstar checks the
  caller again, but it relies on Chrome and Firefox for the first check.
- **A session you start yourself is trusted with your files.** Northstar does not
  sandbox the assistant. It sandboxes only what Northstar writes into it.

If you do not want an assistant reachable from the browser on a shared or untrusted
machine, run `northstar uninstall` to remove the helper, or do not start agents with
`northstar run` there. Sessions end with the terminal, and `northstar daemon stop`
closes the daemon.

## Supply chain

- Production dependencies are small: `@modelcontextprotocol/sdk`, `zod`, `yaml`,
  `@xterm/headless` for the rendered screen, and `@lydell/node-pty` for the pseudo
  terminal. `@lydell/node-pty` ships prebuilt binaries for macOS and Linux as
  optional packages, so installing it compiles nothing. Northstar shells out only to
  `ps`, always through `execFile` with an argument array and never through a shell.
- `npm audit --omit=dev` currently reports advisories only in packages the MCP SDK
  brings in for its HTTP transports (`hono`, `@hono/node-server`, `qs`, `fast-uri` and
  `ip-address`). Northstar serves MCP over stdio only and never loads those transports,
  and `@lydell/node-pty`, `@xterm/headless`, `yaml` and `zod` add none. The build tooling
  has advisories of its own, in the test and lint tools that are not published.
  `vite` is pinned to a release with a patched `esbuild`, and `esbuild` and `tmp` are held
  at fixed patched versions through root `overrides`.
- The npm package is published from CI with **provenance** enabled.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report privately via a
[GitHub security advisory](https://github.com/pallandir/northstar/security/advisories/new)
or by contacting the maintainer through the address in `LICENSE.md`. We aim to
acknowledge reports within a few days.
