import { parseColor, toHex } from "./contrast.js";
import { parseDesign, resolveRefs } from "./parse.js";

export type ExportFormat = "css" | "tailwind" | "dtcg";

const kebab = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

function entries(value: unknown): Array<[string, Record<string, unknown> | string]> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, Record<string, unknown> | string>);
}

function dimension(value: string): { value: number; unit: "px" | "rem" } | undefined {
  const match = /^(-?[\d.]+)(px|rem)$/.exec(value.trim());
  return match ? { value: Number(match[1]), unit: match[2] as "px" | "rem" } : undefined;
}

interface Tokens {
  colors: Array<[string, string]>;
  fonts: Array<[string, string]>;
  sizes: Array<[string, string]>;
  radii: Array<[string, string]>;
  spaces: Array<[string, string]>;
}

function collect(source: string): Tokens {
  const fm = parseDesign(source).frontmatter;
  const resolve = (value: unknown) => resolveRefs(fm, String(value));
  const tokens: Tokens = { colors: [], fonts: [], sizes: [], radii: [], spaces: [] };
  for (const [key, value] of entries(fm.colors)) tokens.colors.push([kebab(key), resolve(value)]);
  for (const [role, def] of entries(fm.typography)) {
    if (typeof def !== "object") continue;
    if (def.fontFamily) tokens.fonts.push([kebab(role), resolve(def.fontFamily)]);
    if (def.fontSize) tokens.sizes.push([kebab(role), resolve(def.fontSize)]);
  }
  for (const [key, value] of entries(fm.rounded)) tokens.radii.push([kebab(key), resolve(value)]);
  for (const [key, value] of entries(fm.spacing)) tokens.spaces.push([kebab(key), resolve(value)]);
  return tokens;
}

const fontStack = (family: string) =>
  /mono|code/i.test(family)
    ? `"${family}", ui-monospace, monospace`
    : `"${family}", system-ui, sans-serif`;

export function exportCss(source: string): string {
  const t = collect(source);
  const lines = [":root {"];
  for (const [key, value] of t.colors) lines.push(`  --color-${key}: ${value};`);
  for (const [key, value] of t.fonts) lines.push(`  --font-${key}: ${fontStack(value)};`);
  for (const [key, value] of t.sizes) lines.push(`  --text-${key}: ${value};`);
  for (const [key, value] of t.radii) lines.push(`  --radius-${key}: ${value};`);
  for (const [key, value] of t.spaces) lines.push(`  --space-${key}: ${value};`);
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

export function exportTailwind(source: string): string {
  const t = collect(source);
  const lines = ['@import "tailwindcss";', "", "@theme {"];
  for (const [key, value] of t.colors) lines.push(`  --color-${key}: ${value};`);
  for (const [key, value] of t.fonts) lines.push(`  --font-${key}: ${fontStack(value)};`);
  for (const [key, value] of t.sizes) lines.push(`  --text-${key}: ${value};`);
  for (const [key, value] of t.radii) lines.push(`  --radius-${key}: ${value};`);
  for (const [key, value] of t.spaces) {
    if (key === "unit") lines.push(`  --spacing: ${value};`);
    else lines.push(`  --spacing-${key}: ${value};`);
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

export function exportDtcg(source: string): string {
  const t = collect(source);
  const color: Record<string, unknown> = {};
  for (const [key, value] of t.colors) {
    const rgb = parseColor(value);
    color[key] = rgb
      ? {
          $type: "color",
          $value: {
            colorSpace: "srgb",
            components: rgb.map((c) => Number(c.toFixed(4))),
            hex: toHex(rgb),
          },
        }
      : { $type: "color", $value: value };
  }
  const dimensions = (list: Array<[string, string]>) =>
    Object.fromEntries(
      list.map(([key, value]) => [key, { $type: "dimension", $value: dimension(value) ?? value }]),
    );
  const fontFamily = Object.fromEntries(
    t.fonts.map(([key, value]) => [key, { $type: "fontFamily", $value: value }]),
  );
  return `${JSON.stringify(
    {
      color,
      fontFamily,
      fontSize: dimensions(t.sizes),
      radius: dimensions(t.radii),
      spacing: dimensions(t.spaces),
    },
    null,
    2,
  )}\n`;
}

export function exportDesign(source: string, format: ExportFormat): string {
  if (format === "css") return exportCss(source);
  if (format === "tailwind") return exportTailwind(source);
  return exportDtcg(source);
}
