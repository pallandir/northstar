# Third-Party Licenses

Northstar ships two published artifacts: the `@pallandir/northstar` npm package and
the browser extension bundle. The runtime dependencies compiled into those
artifacts are listed below, followed by the attribution for the design canon and
the curated design data.

## Bundled runtime dependencies

| Package | Version | License | Source |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.29.0 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| `zod` | 3.25.76 | MIT | https://github.com/colinhacks/zod |
| `yaml` | 2.9.0 | ISC | https://github.com/eemeli/yaml |
| `dompurify` | 3.4.11 | MPL-2.0 OR Apache-2.0 | https://github.com/cure53/DOMPurify |
| `marked` | 18.0.5 | MIT | https://github.com/markedjs/marked |
| `@material-symbols/svg-400` | 0.45.4 | Apache-2.0 | https://github.com/marella/material-symbols |

The MIT, Apache-2.0, and MPL-2.0 license texts apply as published by each project
at the source above. `@material-symbols/svg-400` repackages Google's Material
Symbols icons, which are themselves licensed under Apache-2.0.

## Design canon and data

The Northstar canon, router skill, critique rubric and the curated design data
are distilled from the projects below. The root `NOTICE` file carries the
attribution and the statement of changes.

| Work | License | Source |
| --- | --- | --- |
| impeccable | Apache-2.0 | https://github.com/pbakaus/impeccable |
| frontend-design (Anthropic skills) | Apache-2.0 | https://github.com/anthropics/skills |
| ui-ux-pro-max 2.5.0 | MIT | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill |
| top-design (wondelai skills) | MIT | https://github.com/wondelai/skills |
| taste-skill (Leon Lin and blueemi) | MIT | https://github.com/Leonxlnx/taste-skill |
| make-interfaces-feel-better (Jakub Krehel) | MIT | https://github.com/jakubkrehel/make-interfaces-feel-better |
| emil-design-eng (Emil Kowalski skills) | MIT | https://github.com/emilkowalski/skills |
| Web Interface Guidelines (Vercel) | MIT | https://github.com/vercel-labs/web-interface-guidelines |
| DESIGN.md format | Apache-2.0 | https://github.com/google-labs-code/design.md |

The curated data in `packages/data/json` is derived from the ui-ux-pro-max CSV
files under the MIT License, whose text ships with the data as
`LICENSE-ui-ux-pro-max.txt`.
