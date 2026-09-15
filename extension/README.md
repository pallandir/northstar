# Northstar extension

MV3 extension to leave comments on any frontend. One source tree in `core/`
builds two targets, `chromium/` and `firefox/`.

## What it does

- Activates per tab from the toolbar icon, then overlays a draggable toolbar; you
  click any element to open one popover where you can comment, recolor, or edit
  its copy.
- Renders a pin and the popover in a closed shadow DOM, isolated from page styles,
  and promotes that host into the browser's top layer so no page can stack above it.
- Captures the element fingerprint (selector, text, computed styles, rect) and
  probes the page's own framework state, in the main world, for the component
  name, source location and route it belongs to.
- On `localhost`, posts comments to the project's MCP server (choosing the most
  recently started one) so they save into the repo as you go. On a remote page it
  keeps them in extension storage for **Handoff** export and never calls loopback.
- Sending a batch is one request. The server answers whether it managed to type the
  request into your terminal, and the toolbar shows the reason when it did not.

## Source location (the gold path)

Northstar resolves `file:line:column` and the component stack directly, by
reading React, Vue, Svelte or Angular debug state already present in a dev build,
with no plugin to install. When none of that is present, or in a production
build, the comment still carries a stable CSS selector, the element's own text,
and its route, so the assistant is never left with only an XPath.

## Develop

```bash
npm run dev --workspace @northstar/chromium     # watching build into chromium/dist
npm run build:chromium                          # one-shot -> chromium/dist
npm run build:firefox                           # one-shot -> firefox/dist
npm run watch --workspace @northstar/firefox    # watching build into firefox/dist
npm run lint:amo                                # AMO validator against firefox/dist
npm test --workspace @northstar/core            # vitest
```

Load `extension/chromium/dist` via `chrome://extensions` → Developer mode → Load
unpacked.

For Firefox, load `extension/firefox/dist` via `about:debugging` → This Firefox →
Load Temporary Add-on, or run `npm run start --workspace @northstar/firefox`.

Both targets build from `core/`, one copy of the source. The Vite `root` is
`extension/core`, so every manifest entry path is relative to that directory;
each target's `build.outDir` points back into its own directory.

The CRXJS dev *server* (`vite`, not `vite build --watch`) does not work for this
project on either engine: it resolves `/@fs/` ids against the Vite root and
cannot read the `@material-symbols` SVGs from the hoisted `node_modules`. Use the
watching builds above instead.

Everything reaches the browser API through `core/src/lib/browser.ts`, which
resolves to `browser` on Firefox and `chrome` on Chromium. Never call `chrome.*`
directly: on Firefox it is callback-style and every `await` resolves to
`undefined`.
