import { PACKAGE, SERVERS, launchOf } from "../../src/install/plans/index.js";
import { formatJson } from "./json.js";

export const AUTHOR = { name: "pallandir", url: "https://github.com/pallandir" };
export const HOMEPAGE = "https://github.com/pallandir/northstar";
export const LICENSE = "MIT";

const DESCRIPTION =
  "A UI design advisory framework for AI agents: brief, direction, system, compose, critique and polish, library first and free of generic AI defaults.";

export function pluginManifest(version: string): string {
  return formatJson({
    name: "northstar",
    description: DESCRIPTION,
    version,
    author: AUTHOR,
    homepage: HOMEPAGE,
    license: LICENSE,
    keywords: ["ui", "design", "design-system", "frontend", "anti-slop", "mcp"],
  });
}

export function marketplaceManifest(version: string): string {
  return formatJson({
    name: "northstar",
    owner: AUTHOR,
    metadata: { description: DESCRIPTION, version },
    plugins: [
      {
        name: "northstar",
        source: "./plugin",
        description: DESCRIPTION,
        version,
        author: AUTHOR,
        homepage: HOMEPAGE,
        license: LICENSE,
        keywords: ["ui", "design", "design-system", "frontend", "anti-slop"],
        category: "design",
      },
    ],
  });
}

export function hooksManifest(version: string): string {
  const matcher = "Edit|Write|MultiEdit|NotebookEdit";
  return formatJson({
    hooks: {
      PostToolUse: [
        {
          matcher,
          hooks: [
            {
              type: "command",
              command: `npx -y ${PACKAGE}@${version} hook post-edit --agent claude`,
              timeout: 20,
            },
          ],
        },
      ],
    },
  });
}

export function mcpManifest(version: string): string {
  const { command, args } = launchOf({ version });
  const mcpServers = Object.fromEntries(
    SERVERS.map((server) => [server.name, { command, args: [...args, ...server.serve] }]),
  );
  return formatJson({ mcpServers });
}
