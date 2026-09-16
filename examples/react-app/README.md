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

In Chrome or another Chromium browser, open `chrome://extensions`, enable
Developer mode, choose **Load unpacked**, and select
`extension/chromium/dist`.

In Firefox, open `about:debugging` > **This Firefox** > **Load Temporary Add-on**
and select `extension/firefox/dist/manifest.json`. Grant the extension access to
`localhost` when Firefox asks.

## Connect Codex to the local MCP server

After the MCP build above, run this from `examples/react-app`:

```bash
codex mcp add northstar -- node ../../mcp/dist/index.js
```

This registers the local server command with Codex. Start Codex from
`examples/react-app` so its working directory is the demo, the server writes
`.northstar/` there, and source paths match the demo files.

Activate Northstar in the browser, click an element, leave a comment, and use
**Send to AI**. Exercise both routes and confirm that Codex can read the local
comment through the `list_comments` MCP tool. Comments and screenshots remain
in the gitignored `.northstar/` directory.

The example's `react-router-dom` dependency is installed by the dedicated
`npm ci --prefix examples/react-app` command above; it is not supplied by the
root install.
