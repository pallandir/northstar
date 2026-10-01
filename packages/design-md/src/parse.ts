import { parse } from "yaml";

export const SECTION_ORDER = [
  "Overview",
  "Colors",
  "Typography",
  "Layout",
  "Elevation & Depth",
  "Shapes",
  "Components",
  "Do's and Don'ts",
] as const;

const ALIASES: Record<string, (typeof SECTION_ORDER)[number]> = {
  "brand & style": "Overview",
  "layout & spacing": "Layout",
  elevation: "Elevation & Depth",
  "elevation and depth": "Elevation & Depth",
  "dos and donts": "Do's and Don'ts",
  "do's and don'ts": "Do's and Don'ts",
};

export interface ParsedDesign {
  frontmatter: Record<string, unknown>;
  body: string;
  sections: string[];
}

export class DesignParseError extends Error {}

export function canonicalSection(heading: string): string {
  const clean = heading.trim().replace(/\s+/g, " ");
  const known = SECTION_ORDER.find((name) => name.toLowerCase() === clean.toLowerCase());
  return known ?? ALIASES[clean.toLowerCase()] ?? clean;
}

export interface Frontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

export function parseFrontmatter(source: string): Frontmatter {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const match = FRONTMATTER.exec(text);
  if (!match) {
    throw new DesignParseError(
      "DESIGN.md has no YAML frontmatter, start the file with a --- block or run design_md_normalize",
    );
  }
  let data: unknown;
  try {
    data = parse(match[1] ?? "");
  } catch (err) {
    throw new DesignParseError(
      `DESIGN.md frontmatter is not valid YAML: ${(err as Error).message}`,
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DesignParseError("DESIGN.md frontmatter must be a YAML mapping");
  }
  return { frontmatter: data as Record<string, unknown>, body: match[2] ?? "" };
}

export function parseDesign(source: string): ParsedDesign {
  const { frontmatter, body } = parseFrontmatter(source);
  const sections = [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => canonicalSection(m[1] ?? ""));
  return { frontmatter, body, sections };
}

export function lookup(root: Record<string, unknown>, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export const REF = /\{([A-Za-z0-9_.-]+)\}/g;

export function resolveRefs(root: Record<string, unknown>, value: string, depth = 0): string {
  if (depth > 8) return value;
  return value.replace(REF, (whole, path: string) => {
    const found = lookup(root, path);
    return typeof found === "string" || typeof found === "number"
      ? resolveRefs(root, String(found), depth + 1)
      : whole;
  });
}
