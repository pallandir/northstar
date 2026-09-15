# Contributing to Northstar

Thanks for taking the time to look at Northstar. It is a small project with a clear
job, so contributions that keep it small and sharp are the ones most likely to
land. Bug reports, doc fixes, and focused pull requests are all welcome.

If you are planning something bigger than a bug fix, open an issue first so we can
talk through the approach before you write a lot of code. It saves everyone time.

## Before you start

You will need Node 20 or newer and a Chromium browser to test the extension. The
repo uses npm workspaces, so a single install at the root covers every package.

## Getting set up

Clone the repo, install dependencies, and build both workspaces.

```sh
git clone https://github.com/pallandir/northstar.git
cd northstar
npm install
npm run build
```

## How the repo is laid out

- `mcp/` is the MCP server. It speaks MCP over stdio to the assistant and runs a
  loopback HTTP listener for the extension.
- `extension/core/` is the extension source and tests, shared by both browser
  targets. `extension/chromium/` and `extension/firefox/` each hold one Vite
  config, one manifest, and one store listing; neither carries its own copy of
  the source.
- `docs/` is the architecture and flow documentation. Start there if you want to
  understand how a comment travels from the browser to your source.
- `examples/` holds a sample app for trying things out.

## Running it while you work

The two halves run independently.

For the server:

```sh
npm run dev --workspace @pallandir/northstar
```

For the extension:

```sh
npm run dev --workspace @northstar/chromium
```

Then load `extension/chromium/dist` as an unpacked extension from
`chrome://extensions` with Developer mode turned on. Reload the extension card
after a rebuild.

## Checks to run before you push

Please make sure these pass locally. CI runs the same set, so it is faster to
catch problems here.

```sh
npm run lint        # biome
npm run typecheck   # tsc across workspaces
npm run test        # node:test for the server, vitest for the extension
```

Keep the diff focused. Match the style of the code around you, and avoid adding
comments that just restate what the code already says.

## Commits and pull requests

Commit messages follow Conventional Commits, and a commit hook checks them, so a
message like `fix(extension): guard against a missing tab id` is the shape to aim
for. The types in use are the usual ones: `feat`, `fix`, `refactor`, `docs`,
`test`, `chore`, and so on.

Branch off `develop` and open your pull request against `develop`. Describe what
changed and why, and mention anything you were not sure about. Small, reviewable
pull requests move faster than large ones.

## A note on the license

Northstar is released under the PolyForm Noncommercial License 1.0.0. By
contributing, you agree that your contribution is offered under the same terms.
If you have a commercial use case, the contact for a commercial license is in
[LICENSE.md](./LICENSE.md).
