# Northstar local demo

This small Vite and React app is a local fixture for trying the Northstar
extension. It is intentionally outside the root npm workspaces and CI, so a
clone must install its dependencies separately.

## Build and run

Run these commands from the repository root, in order:

```bash
npm ci
npm ci --prefix examples/react-app
npm run build --workspace @pallandir/northstar
npm run build:chromium
npm run build:firefox
npm run lint:amo
```

Then start the demo in a second terminal:

```bash
npm run dev --prefix examples/react-app
```

The app is served at `http://localhost:3001` and has two routes:

- `http://localhost:3001/`
- `http://localhost:3001/users/8123`

## Load the local extensions

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
and select `extensions/chromium/dist`. Copy the extension id shown on its card, the
local helper only answers extensions it was told about, you pass the id in the next
section.

In Firefox, open `about:debugging` > **This Firefox** > **Load Temporary Add-on**
and select `extensions/firefox/dist/manifest.json`. Grant the extension access to
`localhost` when Firefox asks.

## Connect Codex to the local MCP server

After the MCP build above, register the helper and the server from the repository root.
Pass the Chrome extension id you copied, or leave `--allow-extension` out when you only
use Firefox:

```bash
node mcp/dist/cli.js install --agent codex --allow-extension <chrome extension id>
```

This registers the MCP server with Codex and the native messaging helper for Chrome
and Firefox, both pointing at your working tree build. Then start Codex through
Northstar from `examples/react-app`, so its working directory is the demo, the server
writes `.northstar/` there, and source paths match the demo files:

```bash
cd examples/react-app
node ../../mcp/dist/cli.js run codex
```

Activate Northstar in the browser. There is nothing to connect. Click an element, leave
a comment, and use **Send to AI**. Northstar waits for Codex to be idle, writes one
fixed line and presses Enter, and Codex reads the comment through the `list_comments`
MCP tool. Try it with a permission prompt on screen to see Northstar decline and say
why, and from the right click menu with some text selected. Comments and screenshots
remain in the gitignored `.northstar/` directory.

The example's `react-router-dom` dependency is installed by the dedicated
`npm ci --prefix examples/react-app` command above; it is not supplied by the
root install.
