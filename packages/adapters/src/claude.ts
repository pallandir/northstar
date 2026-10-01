import { formatJson } from "./json.js";

export const AUTHOR = { name: "pallandir", url: "https://github.com/pallandir" };
export const HOMEPAGE = "https://github.com/pallandir/northstar";
export const LICENSE = "PolyForm-Noncommercial-1.0.0";

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
  const base = "hook post-edit --agent claude";
  const command = `sh -c '(command -v northstar >/dev/null 2>&1 && northstar ${base}) || npx -y @pallandir/northstar@${version} ${base} || true'`;
  return formatJson({
    hooks: {
      PostToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [{ type: "command", command, timeout: 20 }],
        },
      ],
    },
  });
}
