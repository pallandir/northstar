import { parseColor, toHex } from "./contrast.js";
import { isGenericFamily, quoteFamily, splitFontStack } from "./fonts.js";
import { parseDesign, resolveRefs } from "./parse.js";
import { kebab } from "./text.js";

export type ExportFormat = "css" | "tailwind" | "dtcg";

function entries(value: unknown): Array<[string, Record<string, unknown> | string]> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, Record<string, unknown> | string>);
}

function dimension(value: string, token: string): { value: number; unit: "px" | "rem" } {
  const trimmed = value.trim();
  if (/^-?0(\.0+)?$/.test(trimmed)) return { value: 0, unit: "px" };
  const match = /^(-?(?:\d+|\d*\.\d+))(px|rem)$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `${token} is ${value}, DTCG dimensions support only px or rem, change it in DESIGN.md or export css instead`,
    );
  }
  return { value: Number(match[1]), unit: match[2] as "px" | "rem" };
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

function fontStack(value: string): string {
  const families = splitFontStack(value);
  if (families.some(isGenericFamily)) return families.map(quoteFamily).join(", ");
  const fallback = /mono|code/i.test(value) ? "ui-monospace, monospace" : "system-ui, sans-serif";
  return `${families.map(quoteFamily).join(", ")}, ${fallback}`;
}

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
  const dimensions = (group: string, list: Array<[string, string]>) =>
    Object.fromEntries(
      list.map(([key, value]) => [
        key,
        { $type: "dimension", $value: dimension(value, `${group}.${key}`) },
      ]),
    );
  const dtcgFamily = (value: string) => {
    const families = splitFontStack(value);
    return families.length === 1 ? families[0] : families;
  };
  const fontFamily = Object.fromEntries(
    t.fonts.map(([key, value]) => [key, { $type: "fontFamily", $value: dtcgFamily(value) }]),
  );
  return `${JSON.stringify(
    {
      color,
      fontFamily,
      fontSize: dimensions("typography", t.sizes),
      radius: dimensions("rounded", t.radii),
      spacing: dimensions("spacing", t.spaces),
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
