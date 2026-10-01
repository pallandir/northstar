export const AUTHOR = { name: "pallandir", url: "https://github.com/pallandir" };
export const HOMEPAGE = "https://github.com/pallandir/northstar";
export const LICENSE = "PolyForm-Noncommercial-1.0.0";

const DESCRIPTION =
  "A UI design advisory framework for AI agents: brief, direction, system, compose, critique and polish, library first and free of generic AI defaults.";

export function pluginManifest(version: string): string {
  return `${JSON.stringify(
    {
      name: "northstar",
      description: DESCRIPTION,
      version,
      author: AUTHOR,
      homepage: HOMEPAGE,
      license: LICENSE,
      keywords: ["ui", "design", "design-system", "frontend", "anti-slop", "mcp"],
    },
    null,
    2,
  )}\n`;
}

export function marketplaceManifest(version: string): string {
  return `${JSON.stringify(
    {
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
    },
    null,
    2,
  )}\n`;
}
