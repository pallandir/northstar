# Security

Northstar is a developer tool that runs entirely on your machine. You can leave
comments on any running frontend, local or a remote preview, but everything you
capture stays local: the only thing that crosses a trust boundary is a comment
you explicitly created, and it only ever travels to the loopback listener owned
by your own AI coding assistant.

## Threat model

- **Processing stays local.** The MCP server binds to `127.0.0.1` only and never
  listens on a public interface. Wherever you leave a comment, the extension
  sends it only to that loopback listener. No comment, screenshot, or source path
  leaves your machine, and there is no remote backend.
- **No standing access to any page.** The extension declares no content scripts
  and no web-page host permissions, so it runs on no site by default. The overlay
  is injected only into the single tab you activate, only after you click the
  toolbar button, under the `activeTab` grant, and that access is dropped as soon
  as the tab navigates. Visiting a page never gives the extension a foothold.
- **The main-world probe reads only.** Resolving a component and a route requires
  reading state a page's own framework attaches to its DOM nodes, which an
  isolated-world content script cannot see. Northstar injects a second script
  into the page's main world for this, on the same activation as the overlay.
  That script never writes to a page object's prototype, never calls back into
  the page beyond dispatching its own events, and has no extension API access
  from that world; every reader is wrapped so an unusual page can make it return
  nothing, never throw into that page's own execution.
- **The network surface is loopback only.** The extension's only host permissions
  are `localhost`, `127.0.0.1`, and `*.localhost`, used solely by the background
  context to reach the ingest listener. It cannot make a network request to any
  other origin. On Firefox these are opt-in and are requested from the popup.
- **The ingest listener only accepts the extension.** The localhost HTTP server
  rejects any request whose `Origin` is a web page (`http(s)://…`) and any
  request whose `Host` header is not loopback. This closes two attack paths a
  malicious web page you happen to be visiting could otherwise use:
  - **CSRF / store poisoning:** injecting comments into your store (which your AI
    assistant later reads and may act on) or deleting your comments.
  - **DNS rebinding:** pointing an attacker-controlled hostname at `127.0.0.1`.
  Every ingested payload is also validated against a strict schema with bounded
  field sizes.
- **Comments are untrusted input to the assistant.** The MCP read tools treat
  every comment's text and selector as *data describing a change*, never as
  instructions. The assistant acts only on the design intent, binds edits to the
  located source, stays within UI changes, and sends no page content or comment
  data anywhere.
- **What Northstar types into your terminal is a fixed constant.** Sending a batch
  makes the server type one line into the terminal your assistant runs in. That
  line is a compile-time string. No comment text, count, id, or any other part of
  an HTTP request reaches the terminal, so nothing that arrives over loopback can
  change what your assistant is told to do. Repeat sends within a few seconds are
  coalesced into a single line, so the channel cannot be driven in a loop.
- **Northstar will not answer a prompt for you.** Before typing it reads the
  visible pane and refuses when a numbered choice or a yes/no question is showing,
  and it refuses if it cannot read the pane at all. It types only after seeing the
  pane hold still across two reads.
- **Least-privilege extension.** The extension requests only `activeTab`,
  `scripting`, `storage`, and `unlimitedStorage`, plus the loopback host
  permissions above. It requests no `debugger` permission and holds no capability
  to drive a page over the DevTools protocol.
- **No remote code, no telemetry.** The extension and server build to static
  assets. The published npm package ships only `dist/`. There is no analytics,
  tracking, or external network call.

## What this does not defend against

Northstar v2 removed the session token, so the ingest listener now accepts any
request that reaches it from a browser-extension origin on loopback. **Any process
already running as you on this machine can therefore post comments into your
store.** That is a deliberate trade, made to remove the pairing step, and it is
bounded rather than unbounded:

- Such a process could already read and write `.northstar/` directly, so the store
  itself is not a new target.
- The escalation that would matter, making your assistant follow attacker-written
  instructions, is closed by the fixed typed line above and by the rule that
  comment text is data. The worst outcome is a spurious "read your comments"
  nudge, plus whatever the assistant decides to do with comments you can see and
  delete in the toolbar.

If you do not want that trade on a shared or untrusted machine, set
`NORTHSTAR_INJECT=0` to disable the typing entirely, or do not run the extension
there.

## Supply chain

- Production dependencies are minimal (`@modelcontextprotocol/sdk`, `zod`) and
  carry no known vulnerabilities. The terminal handoff shells out only to `ps`,
  `tmux`, and `osascript`, always through `execFile` with an argument array and
  never through a shell.
- Build-time tooling carries no known advisories: `npm audit` reports zero
  vulnerabilities. `vite` is pinned to a release with a patched `esbuild`, and
  `esbuild` and `tmp` are held at fixed patched versions through root
  `overrides`.
- The npm package is published from CI with **provenance** enabled.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report privately via a
[GitHub security advisory](https://github.com/pallandir/northstar/security/advisories/new)
or by contacting the maintainer through the address in `LICENSE.md`. We aim to
acknowledge reports within a few days.
