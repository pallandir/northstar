# Releasing

Northstar ships three artifacts on one shared version: the `@pallandir/northstar`
npm package, the Chrome Web Store zip, and the Firefox (AMO) package. This page is
the checklist for cutting a release of all three.

## Versions

The version lives in three hand-edited places and they must match before a
release:

- root `package.json`
- `mcp/package.json` for the npm package
- `extension/core/manifest.base.ts` (both browser targets read it)

There is no automatic sync, so bump all three when you cut a release.

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

1. Bump the version in `mcp/package.json`, root `package.json`, and
   `extension/core/manifest.base.ts` (see above).
2. Update `CHANGELOG.md`.
3. Commit the bump.
4. Tag the release and push the tag. The npm and Firefox workflows both trigger
   on any `v*` tag:

   ```sh
   git tag v2.0.0
   git push origin v2.0.0
   ```

`publish-npm.yml` checks out the repo, builds the server, copies the root
`LICENSE.md` into the package, and runs `npm publish --workspace @pallandir/northstar`
with provenance. You can also run it manually from the Actions tab
(`workflow_dispatch`).

### Verify before tagging

Inspect the exact tarball contents without publishing:

```sh
npm pack --dry-run --workspace @pallandir/northstar
```

The file list should be `dist/`, `README.md`, `LICENSE.md`, and `package.json`,
and nothing from `src/` or `tests/`. The `prepack` step copies `LICENSE.md` into
the package from the repo root, so it is present in both CI and a local pack even
though the file is gitignored.

## Packaging the extension for the stores

Chrome and Firefox build from the same `extension/core/` source into separate
`dist/` directories, because Gecko has no extension service worker and needs its
own `browser_specific_settings`. Each is a zip with the manifest at the zip root.

### Chrome Web Store

1. Build and package:

   ```sh
   npm run package:chromium
   ```

   This produces `extension/chromium/northstar-chrome.zip`.

2. Verify the zip is a coherent build before you upload it:

   ```sh
   unzip -l extension/chromium/northstar-chrome.zip
   ```

   Confirm it contains `manifest.json` at the root, all four icons, the
   background loader, the popup html and its js and css, the content-script
   chunk, and that the asset hashes referenced in the manifest match files
   actually in the zip. Always re-run the package step after any code change so
   the zip and the manifest come from the same build.

3. Submit using the listing copy in
   [extension/chromium/STORE.md](../extension/chromium/STORE.md): the
   description, the permission justifications, the data-use disclosures, and the
   privacy-policy URL. Make sure the repo is public so the privacy-policy URL
   resolves.

### Firefox (AMO)

Firefox publishing is a `v*`-tagged GitHub Actions job
(`.github/workflows/publish-firefox.yml`), reading `WEB_EXT_API_KEY` and
`WEB_EXT_API_SECRET` from the `release` environment. It is inert until those
secrets are added, so tagging never submits to AMO by accident.

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

   It must report zero errors. One `UNSAFE_VAR_ASSIGNMENT` warning is expected:
   the Handoff export writes DOMPurify-sanitized HTML.

4. Build the reviewer source archive (AMO requires it, because the shipped code
   is minified):

   ```sh
   npm run source --workspace @northstar/firefox
   ```

5. Pushing the `v*` tag runs the workflow, which builds, asserts the built
   manifest version matches the tag, runs the AMO validator, and calls
   `web-ext sign --channel listed --approval-timeout 0`, uploading the source
   archive and the reviewer notes in `extension/firefox/amo-metadata.json`. The
   submission then waits in AMO's human review queue; the workflow does not
   block on that.

Listing copy lives in [extension/firefox/STORE.md](../extension/firefox/STORE.md).

## Release checklist

- [ ] Versions bumped and matching across root `package.json`, `mcp/package.json`
      and `extension/core/manifest.base.ts`.
- [ ] `CHANGELOG.md` updated for the release.
- [ ] `npm run lint`, `npm run typecheck`, and `npm test` pass.
- [ ] `npm pack --dry-run` tarball looks right.
- [ ] `npm run package:chromium` rebuilt and verified with `unzip -l`.
- [ ] `npm run lint:amo` clean on the Firefox build.
- [ ] `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` present on `release` if this is a
      Firefox submission (first submission additionally needs the AMO web UI step
      above).
- [ ] Tag pushed. Confirm the npm publish workflow and, if configured, the
      Firefox submission both succeed in the Actions tab.
