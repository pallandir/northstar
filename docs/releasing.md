# Releasing

Northstar ships three artifacts on one shared version: the `@pallandir/northstar`
npm package, the Chrome Web Store zip, and the Firefox (AMO) package. This page is
the checklist for cutting a release of all three.

## Versions

One version covers everything, and the root `package.json` is the source of truth.
These must all equal it before a release:

- every workspace `package.json`: `mcp`, `canon`, `packages/*` and `extensions/*`
- `plugin/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`, in both the metadata and the plugin entry
- `mcp/src/config.ts` (`VERSION`, reported by the MCP server and the daemon) and
  `extensions/core/manifest.base.ts` (both browser targets read it), which either
  hold the same number or read it from `package.json`

Check them in one step:

```sh
node scripts/check-versions.mjs
```

It lists every place that differs and exits 1. CI runs it on every push and the npm
publish workflow runs it before publishing. After changing versions, run
`npm run gen` so the generated plugin and skill files pick up the new number.

## Publishing the MCP server to npm

Publishing happens in CI, not from a laptop. The package sets
`publishConfig.provenance: true`, and provenance requires **OIDC trusted
publishing**: `.github/workflows/publish-npm.yml` authenticates to npm with a
short-lived OIDC token from GitHub Actions, not a stored secret, so there is no
`NPM_TOKEN` or `NODE_AUTH_TOKEN` to configure. A manual `npm publish` from your
machine will fail; the release path is a git tag.

### One-time setup

The `@pallandir` scope on npm is already configured for trusted publishing from
this repository's `release` environment. Nothing further to set up per release.

### Cutting a release

1. Set the version in every place listed above and run `npm run gen`.
2. Update `CHANGELOG.md`.
3. Run `node scripts/check-versions.mjs` and commit the bump.
4. Tag the release, with the tag equal to the version and push the tag. Pushing any `v*` tag automatically submits
   the Firefox build to AMO and publishes the npm package, with no further step:

   ```sh
   git tag v2.3.0
   git push origin v2.3.0
   ```

`publish-npm.yml` checks out the repo, verifies that the tag equals every version in
the repo, runs the typecheck, build, tests, `npm run gen:check` and
`npm run check:pack`, and only then runs `npm publish --workspace @pallandir/northstar`
with provenance. Any failing check stops the release before anything is published. You can also run it manually from the Actions tab
(`workflow_dispatch`).

### Verify before tagging

Inspect the exact tarball contents without publishing:

```sh
npm pack --dry-run --workspace @pallandir/northstar
```

`npm run check:pack` asserts the required files and the size limit. The file list
should be `dist/`, `README.md`, `LICENSE.md`, `NOTICE`, `THIRD_PARTY_LICENSES.md`
and `package.json`, and nothing from `src/` or `tests/`. The `prepack` step copies `LICENSE.md` into
the package from the repo root, so it is present in both CI and a local pack even
though the file is gitignored.

## Packaging the extension for the stores

Chrome and Firefox build from the same `extensions/core/` source into separate
`dist/` directories, because Gecko has no extension service worker and needs its
own `browser_specific_settings`. Each is a zip with the manifest at the zip root.

### Chrome Web Store

1. Build and package:

   ```sh
   npm run package:chromium
   ```

   This produces `extensions/chromium/northstar-chrome.zip`.

2. Verify the zip is a coherent build before you upload it:

   ```sh
   unzip -l extensions/chromium/northstar-chrome.zip
   ```

   Confirm it contains `manifest.json` at the root, all four icons, the
   background loader, the content-script
   chunk, and that the asset hashes referenced in the manifest match files
   actually in the zip. Always re-run the package step after any code change so
   the zip and the manifest come from the same build.

3. Submit using the listing copy in
   [extensions/chromium/STORE.md](../extensions/chromium/STORE.md): the
   description, the permission justifications, the data-use disclosures, and the
   privacy-policy URL. Make sure the repo is public so the privacy-policy URL
   resolves.

### Firefox (AMO)

Firefox publishing is a `v*`-tagged GitHub Actions job
(`.github/workflows/publish-firefox.yml`), reading `WEB_EXT_API_KEY` and
`WEB_EXT_API_SECRET` from the `release` environment. Tagging submits to AMO
automatically, so those secrets must be present before you push a `v*` tag.

1. **First submission only.** A brand new add-on's first listed version has to go
   through the [AMO developer hub](https://addons.mozilla.org/developers/) web UI
   once, to accept the license and set the initial listing. Every version after
   that is handled by the workflow, because the manifest carries
   `browser_specific_settings.gecko.id`.

2. Generate API credentials at AMO → Developer Hub → Manage API Keys, and add
   them as `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` secrets on the `release`
   environment.

3. Locally, verify before tagging:

   ```sh
   npm run lint:amo
   ```

   It must report zero errors.

4. Build the reviewer source archive (AMO requires it, because the shipped code
   is minified):

   ```sh
   npm run source --workspace @northstar/firefox
   ```

5. Pushing the `v*` tag runs the workflow, which builds, asserts the built
   manifest version matches the tag, runs the AMO validator, and calls
   `web-ext sign --channel listed --approval-timeout 0`, uploading the source
   archive and the reviewer notes in `extensions/firefox/amo-metadata.json`. The
   submission then waits in AMO's human review queue; the workflow does not
   block on that.

Listing copy lives in [extensions/firefox/STORE.md](../extensions/firefox/STORE.md).

## Release checklist

- [ ] Versions bumped, `npm run gen` run, and `node scripts/check-versions.mjs` passes.
- [ ] A release that adds a permission (`nativeMessaging`, `contextMenus`) states the
      reason in the store listing and in the notes for reviewers, and the release notes
      warn that Chrome disables an installed extension until its users accept it.
- [ ] `npm install -g` of the packed tarball on macOS and Linux loads `@lydell/node-pty`,
      `northstar install --dry-run` lists the browser helper files, and `northstar doctor`
      reports no failures.
- [ ] `CHANGELOG.md` updated for the release.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm run gen:check` pass.
- [ ] `npm run check:pack` passes.
- [ ] `npm run package:chromium` rebuilt and verified with `unzip -l`.
- [ ] `npm run lint:amo` clean on the Firefox build.
- [ ] `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` present on `release` if this is a
      Firefox submission (first submission additionally needs the AMO web UI step
      above).
- [ ] Tag pushed. Confirm the npm publish workflow and the Firefox submission
      both succeed in the Actions tab.
