import { MODES } from "@northstar/canon";
import { contrastRatio, parseColor } from "./contrast.js";
import { DesignParseError, REF, SECTION_ORDER, lookup, parseDesign, resolveRefs } from "./parse.js";

export interface Issue {
  severity: "error" | "warn";
  path: string;
  message: string;
  rule?: string;
}

export interface ValidateOptions {
  rules: Array<{ id: string; allowable: boolean }>;
  defaultFamilies?: string[];
}

export interface ValidationResult {
  issues: Issue[];
  placeholders: number;
  ready: boolean;
}

const STACKS = ["react", "next", "vue", "svelte", "angular", "solid", "html"];
const DIMENSION = /^-?(\d+|\d*\.\d+)(px|rem|em|%|vw|vh|ch)?$/;
const PLACEHOLDER = /^<[^>]*>$/;
const MIN_CONTRAST = 4.5;

const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
const hasRef = (value: string) => new RegExp(REF.source).test(value);

function walk(value: unknown, path: string, visit: (value: string, path: string) => void): void {
  if (typeof value === "string") visit(value, path);
  else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`, visit));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      walk(item, path ? `${path}.${key}` : key, visit);
  }
}

function pairKeys(colors: Record<string, unknown>): Array<[string, string]> {
  const byNorm = new Map(Object.keys(colors).map((key) => [norm(key), key]));
  const pick = (...names: string[]) => names.map((n) => byNorm.get(n)).find((k) => k !== undefined);
  const pairs: Array<[string, string]> = [];
  const add = (fg: string | undefined, bg: string | undefined) => {
    if (fg && bg && fg !== bg) pairs.push([fg, bg]);
  };
  const surface = pick("surface", "background", "bg", "canvas", "base");
  add(pick("text", "foreground", "onsurface", "ink", "onbackground"), surface);
  for (const role of [
    "primary",
    "secondary",
    "accent",
    "danger",
    "destructive",
    "success",
    "warning",
  ]) {
    add(pick(`on${role}`, `${role}foreground`, `${role}text`), pick(role));
  }
  add(pick("mutedforeground", "onmuted"), pick("muted"));
  add(pick("cardforeground", "oncard"), pick("card"));
  return pairs;
}

export function countPlaceholders(frontmatter: Record<string, unknown>): number {
  let count = 0;
  walk(frontmatter, "", (value) => {
    if (PLACEHOLDER.test(value.trim())) count++;
  });
  return count;
}

export function validateDesign(source: string, options: ValidateOptions): ValidationResult {
  const issues: Issue[] = [];
  let parsed: ReturnType<typeof parseDesign>;
  try {
    parsed = parseDesign(source);
  } catch (err) {
    if (err instanceof DesignParseError) {
      return {
        issues: [{ severity: "error", path: "", message: err.message }],
        placeholders: 0,
        ready: false,
      };
    }
    throw err;
  }
  const { frontmatter: fm, sections } = parsed;
  const error = (path: string, message: string, rule?: string) =>
    issues.push({ severity: "error", path, message, rule });
  const warn = (path: string, message: string, rule?: string) =>
    issues.push({ severity: "warn", path, message, rule });

  if (typeof fm.name !== "string" || !fm.name.trim()) error("name", "name is required");
  for (const key of ["colors", "typography", "rounded", "spacing"]) {
    const value = fm[key];
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length === 0
    ) {
      error(key, `${key} is required and must not be empty`);
    }
  }

  let placeholders = 0;
  walk(fm, "", (value, path) => {
    if (PLACEHOLDER.test(value.trim())) {
      placeholders++;
      if (placeholders <= 10) warn(path, `unfilled placeholder ${value}`);
    }
  });

  walk(fm, "", (value, path) => {
    for (const match of value.matchAll(new RegExp(REF.source, "g"))) {
      const target = lookup(fm, match[1] ?? "");
      if (typeof target !== "string" && typeof target !== "number") {
        error(path, `unresolved reference ${match[0]}`);
      }
    }
  });

  const colors = (fm.colors ?? {}) as Record<string, unknown>;
  if (colors && typeof colors === "object") {
    for (const [key, raw] of Object.entries(colors)) {
      if (typeof raw !== "string") {
        error(`colors.${key}`, "colour must be a string");
        continue;
      }
      const value = resolveRefs(fm, raw);
      if (PLACEHOLDER.test(value) || hasRef(value)) continue;
      if (!parseColor(value)) {
        error(`colors.${key}`, `${value} is not a valid hex, rgb, hsl or oklch colour`);
      }
    }
    if (Object.keys(colors).length > 12) {
      warn(
        "colors",
        `${Object.keys(colors).length} colour roles, aim for four to six plus status colours`,
        "NS-COLOR-PALETTE-SIZE",
      );
    }
  }

  for (const group of ["rounded", "spacing"] as const) {
    const scale = fm[group];
    if (!scale || typeof scale !== "object") continue;
    for (const [key, raw] of Object.entries(scale as Record<string, unknown>)) {
      const value = resolveRefs(fm, String(raw));
      if (PLACEHOLDER.test(value) || hasRef(value)) continue;
      if (!DIMENSION.test(value.trim())) {
        error(`${group}.${key}`, `${value} is not a dimension such as 8px or 0.5rem`);
      }
    }
  }

  const typography = (fm.typography ?? {}) as Record<string, Record<string, unknown>>;
  const families = new Set<string>();
  for (const [role, def] of Object.entries(typography)) {
    if (!def || typeof def !== "object") {
      error(`typography.${role}`, "typography role must be a mapping");
      continue;
    }
    const family = typeof def.fontFamily === "string" ? def.fontFamily : undefined;
    if (!family) error(`typography.${role}.fontFamily`, "fontFamily is required");
    else if (!PLACEHOLDER.test(family) && !/mono|code/i.test(family) && role !== "code") {
      families.add(family);
    }
    if (
      typeof def.fontSize === "string" &&
      !PLACEHOLDER.test(def.fontSize) &&
      !DIMENSION.test(def.fontSize.trim())
    ) {
      error(`typography.${role}.fontSize`, `${def.fontSize} is not a dimension`);
    }
    const display = /^(display|heading|headline|title|h1)$/i.test(role);
    if (
      display &&
      family &&
      options.defaultFamilies?.some((d) => d.toLowerCase() === family.toLowerCase())
    ) {
      warn(
        `typography.${role}.fontFamily`,
        `${family} is a training data default as a display face, confirm it with resolve_font`,
        "NS-TYPE-DEFAULT-DISPLAY",
      );
    }
  }
  if (families.size > 2) {
    warn("typography", `${families.size} font families, use one or two`, "NS-TYPE-FONT-COUNT");
  }

  const checked = new Set<string>();
  const checkPair = (label: string, fgRaw: unknown, bgRaw: unknown) => {
    if (typeof fgRaw !== "string" || typeof bgRaw !== "string" || checked.has(label)) return;
    const fg = parseColor(resolveRefs(fm, fgRaw));
    const bg = parseColor(resolveRefs(fm, bgRaw));
    if (!fg || !bg) return;
    checked.add(label);
    const ratio = contrastRatio(fg, bg);
    if (ratio < MIN_CONTRAST) {
      error(label, `contrast ${ratio.toFixed(2)}:1 is below ${MIN_CONTRAST}:1`, "NS-A11Y-CONTRAST");
    }
  };
  for (const [fg, bg] of pairKeys(colors)) {
    checkPair(`colors.${fg} on colors.${bg}`, colors[fg], colors[bg]);
  }
  const components = (fm.components ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, def] of Object.entries(components)) {
    if (def && typeof def === "object")
      checkPair(`components.${name}`, def.textColor, def.backgroundColor);
  }

  const northstar = (fm.northstar ?? {}) as Record<string, unknown>;
  const mode = northstar.mode;
  if (typeof mode !== "string" || PLACEHOLDER.test(mode)) {
    error("northstar.mode", `mode must be one of ${MODES.join(", ")}`);
  } else if (!(MODES as readonly string[]).includes(mode)) {
    error("northstar.mode", `mode ${mode} is not one of ${MODES.join(", ")}`);
  }
  if (
    typeof northstar.stack === "string" &&
    !PLACEHOLDER.test(northstar.stack) &&
    !STACKS.includes(northstar.stack)
  ) {
    warn("northstar.stack", `stack ${northstar.stack} is not one of ${STACKS.join(", ")}`);
  }
  if (Array.isArray(northstar.allow)) {
    northstar.allow.forEach((entry, i) => {
      const path = `northstar.allow[${i}]`;
      const id = (entry as { rule?: string } | null)?.rule;
      const rule = options.rules.find((r) => r.id === id);
      if (!rule) error(path, `unknown rule ${id}`);
      else if (!rule.allowable) error(path, `${rule.id} cannot be allowed`, rule.id);
      else if (!(entry as { reason?: string }).reason) warn(path, "an allow entry needs a reason");
    });
  }

  for (const name of SECTION_ORDER) {
    if (!sections.includes(name)) warn(`section ${name}`, `missing ## ${name} section`);
  }
  const positions = SECTION_ORDER.filter((name) => sections.includes(name)).map((name) =>
    sections.indexOf(name),
  );
  if (positions.some((index, i) => i > 0 && index < (positions[i - 1] ?? 0))) {
    warn("sections", `sections are out of the canonical order: ${SECTION_ORDER.join(", ")}`);
  }

  return {
    issues,
    placeholders,
    ready: !issues.some((i) => i.severity === "error") && placeholders === 0,
  };
}
