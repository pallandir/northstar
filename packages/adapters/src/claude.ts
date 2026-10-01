import { hookCommand } from "./agents/plan.js";
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
  const matcher = "Edit|Write|MultiEdit";
  return formatJson({
    hooks: {
      PreToolUse: [
        {
          matcher,
          hooks: [
            {
              type: "command",
              command: hookCommand(version, "claude", undefined, "pre-edit"),
              timeout: 10,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher,
          hooks: [{ type: "command", command: hookCommand(version, "claude"), timeout: 20 }],
        },
      ],
    },
  });
}
