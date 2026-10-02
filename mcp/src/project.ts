import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCanon } from "./assets.js";
import { type Issue, parseFrontmatter, validateDesign } from "./design-md/index.js";

export const STACKS = ["next", "react", "vue", "svelte", "angular", "solid", "html"] as const;
export type StackName = (typeof STACKS)[number];

const STACK_ORDER: Array<[StackName, string]> = [
  ["next", "next"],
  ["angular", "@angular/core"],
  ["vue", "vue"],
  ["svelte", "svelte"],
  ["solid", "solid-js"],
  ["react", "react"],
];

interface DesignDoc {
  exists: boolean;
  valid: boolean;
  ready: boolean;
  placeholders: number;
  name?: string;
  mode?: string;
  libraries?: Record<string, string>;
  errors: string[];
  error?: string;
}

export interface DesignRead extends DesignDoc {
  frontmatter?: Record<string, unknown>;
}

interface Gate {
  open: boolean;
  gap?: string;
  next?: string;
}

const MAX_GAPS = 3;

function errorLines(issues: Issue[]): string[] {
  return issues
    .filter((issue) => issue.severity === "error")
    .map((issue) =>
      !issue.path || issue.message.startsWith(issue.path)
        ? issue.message
        : `${issue.path}: ${issue.message}`,
    );
}

export function designGap(design: DesignDoc): string | undefined {
  if (!design.exists) return "there is no DESIGN.md";
  if (design.error) return `DESIGN.md cannot be read: ${design.error}`;
  if (design.ready) return undefined;
  const parts: string[] = [];
  if (design.errors.length) {
    const shown = design.errors.slice(0, MAX_GAPS).join("; ");
    const more = design.errors.length - MAX_GAPS;
    parts.push(`DESIGN.md is not valid yet (${shown}${more > 0 ? `; ${more} more` : ""})`);
  }
  if (design.placeholders > 0) {
    parts.push(`DESIGN.md still has ${design.placeholders} unfilled placeholders`);
  }
  return parts.join(", ");
}

function gateOf(design: DesignDoc): Gate {
  const gap = designGap(design);
  if (!gap) return { open: true };
  return {
    open: false,
    gap,
    next: "Write DESIGN.md before any UI code: design_md_normalize with the designer's direction and write true, or design_system_propose, then design_md_validate until it is ready. If the designer wants the system from Figma, follow northstar://canon/references/figma first.",
  };
}

interface ProjectState {
  root: string;
  stack: StackName;
  shadcn: boolean;
  tailwind: boolean;
  design: DesignDoc;
  gate: Gate;
  product: boolean;
  decisions: boolean;
  stage: "brief" | "direction" | "system" | "compose";
  missing: string[];
}

export function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`${path} is not valid JSON, fix it or remove it: ${(err as Error).message}`);
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

export function readDesign(root: string): DesignRead {
  const path = join(root, "DESIGN.md");
  if (!existsSync(path)) {
    return { exists: false, valid: false, ready: false, placeholders: 0, errors: [] };
  }
  const source = readFileSync(path, "utf8");
  const canon = getCanon();
  const result = validateDesign(source, {
    rules: canon.rules.map((rule) => ({ id: rule.id, allowable: rule.allowable })),
  });
  const errors = errorLines(result.issues);
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseFrontmatter(source).frontmatter;
  } catch (err) {
    return {
      exists: true,
      valid: false,
      ready: false,
      placeholders: 0,
      errors,
      error: (err as Error).message,
    };
  }
  const northstar = (frontmatter.northstar ?? {}) as Record<string, unknown>;
  return {
    exists: true,
    valid: errors.length === 0,
    ready: result.ready,
    placeholders: result.placeholders,
    name: typeof frontmatter.name === "string" ? frontmatter.name : undefined,
    mode: typeof northstar.mode === "string" ? northstar.mode : undefined,
    libraries: northstar.libraries as Record<string, string> | undefined,
    errors,
    frontmatter,
  };
}

export function inspectProject(root: string): ProjectState {
  const deps = dependencies(readJsonFile(join(root, "package.json")));
  const stack = STACK_ORDER.find(([, dep]) => deps.has(dep))?.[0] ?? "html";
  const { frontmatter: _frontmatter, ...design } = readDesign(root);
  const product = existsSync(join(root, "PRODUCT.md"));

  const missing: string[] = [];
  if (!product) missing.push("PRODUCT.md: audience, primary job, success, constraints");
  if (!design.exists) missing.push("DESIGN.md: no design direction yet");
  else if (design.error) missing.push(`DESIGN.md: ${design.error}`);
  else if (!design.ready) missing.push(`DESIGN.md: ${designGap(design)}`);

  const stage = !product
    ? "brief"
    : !design.exists
      ? "direction"
      : !design.ready
        ? "system"
        : "compose";

  return {
    root,
    stack,
    shadcn: existsSync(join(root, "components.json")),
    tailwind: deps.has("tailwindcss"),
    design,
    gate: gateOf(design),
    product,
    decisions: existsSync(join(root, "design", "decisions.md")),
    stage,
    missing,
  };
}
