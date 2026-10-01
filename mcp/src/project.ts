import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { countPlaceholders } from "@northstar/design-md";
import { parse } from "yaml";

export type StackName = "next" | "react" | "vue" | "svelte" | "angular" | "solid" | "html";

const STACK_ORDER: Array<[StackName, string]> = [
  ["next", "next"],
  ["angular", "@angular/core"],
  ["vue", "vue"],
  ["svelte", "svelte"],
  ["solid", "solid-js"],
  ["react", "react"],
];

export interface DesignDoc {
  exists: boolean;
  valid: boolean;
  placeholders: boolean;
  name?: string;
  mode?: string;
  libraries?: Record<string, string>;
  error?: string;
}

export interface ProjectState {
  root: string;
  stack: StackName;
  shadcn: boolean;
  tailwind: boolean;
  design: DesignDoc;
  product: boolean;
  decisions: boolean;
  stage: "brief" | "direction" | "system" | "compose";
  missing: string[];
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function dependencies(pkg: Record<string, unknown> | null): Set<string> {
  const names = new Set<string>();
  for (const key of ["dependencies", "devDependencies"]) {
    const section = pkg?.[key];
    if (section && typeof section === "object") {
      for (const name of Object.keys(section)) names.add(name);
    }
  }
  return names;
}

export function frontmatter(source: string): unknown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) throw new Error("no YAML frontmatter");
  return parse(match[1] ?? "");
}

export function readDesign(root: string): DesignDoc {
  const path = join(root, "DESIGN.md");
  if (!existsSync(path)) return { exists: false, valid: false, placeholders: false };
  const source = readFileSync(path, "utf8");
  try {
    const data = frontmatter(source) as Record<string, unknown>;
    const northstar = (data.northstar ?? {}) as Record<string, unknown>;
    const libraries = northstar.libraries as Record<string, string> | undefined;
    return {
      exists: true,
      valid: typeof data.name === "string" && typeof data.colors === "object",
      placeholders: countPlaceholders(data) > 0,
      name: typeof data.name === "string" ? data.name : undefined,
      mode: typeof northstar.mode === "string" ? northstar.mode : undefined,
      libraries,
    };
  } catch (err) {
    return { exists: true, valid: false, placeholders: false, error: (err as Error).message };
  }
}

export function inspectProject(root: string): ProjectState {
  const deps = dependencies(readJson(join(root, "package.json")));
  const stack = STACK_ORDER.find(([, dep]) => deps.has(dep))?.[0] ?? "html";
  const design = readDesign(root);
  const product = existsSync(join(root, "PRODUCT.md"));
  const modeSet = design.mode !== undefined && !design.mode.startsWith("<");
  const designReady = design.valid && !design.placeholders && modeSet;

  const missing: string[] = [];
  if (!product) missing.push("PRODUCT.md: audience, primary job, success, constraints");
  if (!design.exists) missing.push("DESIGN.md: no design direction yet");
  else if (!design.valid) missing.push("DESIGN.md: invalid frontmatter");
  else if (design.placeholders) missing.push("DESIGN.md: unfilled template placeholders");
  if (design.exists && !modeSet) missing.push("DESIGN.md: northstar.mode");

  const stage = !product
    ? "brief"
    : !design.exists
      ? "direction"
      : !designReady
        ? "system"
        : "compose";

  return {
    root,
    stack,
    shadcn: existsSync(join(root, "components.json")),
    tailwind: deps.has("tailwindcss"),
    design,
    product,
    decisions: existsSync(join(root, "design", "decisions.md")),
    stage,
    missing,
  };
}
