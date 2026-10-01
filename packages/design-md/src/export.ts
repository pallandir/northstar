import { parseColor, parseColorAlpha, toHex } from "./contrast.js";
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
  shadows: Array<[string, string]>;
  motion: Array<[string, string]>;
  darkColors: Array<[string, string]>;
  darkShadows: Array<[string, string]>;
}

function collect(source: string): Tokens {
  const fm = parseDesign(source).frontmatter;
  const resolve = (value: unknown) => resolveRefs(fm, String(value));
  const tokens: Tokens = {
    colors: [],
    fonts: [],
    sizes: [],
    radii: [],
    spaces: [],
    shadows: [],
    motion: [],
    darkColors: [],
    darkShadows: [],
  };
  for (const [key, value] of entries(fm.colors)) tokens.colors.push([kebab(key), resolve(value)]);
  for (const [role, def] of entries(fm.typography)) {
    if (typeof def !== "object") continue;
    if (def.fontFamily) tokens.fonts.push([kebab(role), resolve(def.fontFamily)]);
    if (def.fontSize) tokens.sizes.push([kebab(role), resolve(def.fontSize)]);
  }
  for (const [key, value] of entries(fm.rounded)) tokens.radii.push([kebab(key), resolve(value)]);
  for (const [key, value] of entries(fm.spacing)) tokens.spaces.push([kebab(key), resolve(value)]);
  for (const [key, value] of entries(fm.elevation))
    tokens.shadows.push([kebab(key), resolve(value)]);
  for (const [key, value] of entries(fm.motion)) tokens.motion.push([kebab(key), resolve(value)]);
  const dark = ((fm.themes ?? {}) as Record<string, unknown>).dark as
    | Record<string, unknown>
    | undefined;
  for (const [key, value] of entries(dark?.colors)) {
    tokens.darkColors.push([kebab(key), resolve(value)]);
  }
  for (const [key, value] of entries(dark?.elevation)) {
    tokens.darkShadows.push([kebab(key), resolve(value)]);
  }
  return tokens;
}

function fontStack(value: string): string {
  const families = splitFontStack(value);
  if (families.some(isGenericFamily)) return families.map(quoteFamily).join(", ");
  const fallback = /mono|code/i.test(value) ? "ui-monospace, monospace" : "system-ui, sans-serif";
  return `${families.map(quoteFamily).join(", ")}, ${fallback}`;
}

function themeLines(t: Tokens, indent: string): string[] {
  return [
    ...t.darkColors.map(([key, value]) => `${indent}--color-${key}: ${value};`),
    ...t.darkShadows.map(([key, value]) => `${indent}--shadow-${key}: ${value};`),
  ];
}

function darkBlocks(t: Tokens): string[] {
  if (!t.darkColors.length && !t.darkShadows.length) return [];
  return [
    "",
    ':root[data-theme="dark"] {',
    "  color-scheme: dark;",
    ...themeLines(t, "  "),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    "    color-scheme: dark;",
    ...themeLines(t, "    "),
    "  }",
    "}",
  ];
}

export function exportCss(source: string): string {
  const t = collect(source);
  const lines = [":root {"];
  if (t.darkColors.length) lines.push("  color-scheme: light;");
  for (const [key, value] of t.colors) lines.push(`  --color-${key}: ${value};`);
  for (const [key, value] of t.fonts) lines.push(`  --font-${key}: ${fontStack(value)};`);
  for (const [key, value] of t.sizes) lines.push(`  --text-${key}: ${value};`);
  for (const [key, value] of t.radii) lines.push(`  --radius-${key}: ${value};`);
  for (const [key, value] of t.spaces) lines.push(`  --space-${key}: ${value};`);
  for (const [key, value] of t.shadows) lines.push(`  --shadow-${key}: ${value};`);
  for (const [key, value] of t.motion) lines.push(`  --${key}: ${value};`);
  lines.push("}", ...darkBlocks(t));
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
  for (const [key, value] of t.shadows) lines.push(`  --shadow-${key}: ${value};`);
  for (const [key, value] of t.motion) lines.push(`  --${key}: ${value};`);
  lines.push("}", ...darkBlocks(t));
  return `${lines.join("\n")}\n`;
}

function colorToken(value: string): Record<string, unknown> {
  const rgb = parseColor(value);
  return rgb
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

function lengthOf(token: string, where: string): { value: number; unit: "px" | "rem" } {
  const match = /^(-?(?:\d+|\d*\.\d+))(px|rem)?$/.exec(token);
  if (!match)
    throw new Error(`${where} has a length ${token}, DTCG shadows support only px or rem`);
  return { value: Number(match[1]), unit: (match[2] as "px" | "rem" | undefined) ?? "px" };
}

function shadowToken(value: string, where: string): Record<string, unknown> {
  const layers = splitTop(value).map((layer) => {
    const color = /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})\s*$/.exec(layer);
    if (!color) throw new Error(`${where} has a layer without a trailing colour: ${layer}`);
    const colorValue = color[1] ?? "";
    const head = layer.slice(0, color.index).trim();
    const inset = /^inset\b/.test(head);
    const lengths = head
      .replace(/^inset\s*/, "")
      .split(/\s+/)
      .filter(Boolean);
    if (lengths.length < 2 || lengths.length > 4) {
      throw new Error(`${where} has a layer that is not offset, blur and spread: ${layer}`);
    }
    const [x, y, blur = "0", spread = "0"] = lengths as [string, string, string?, string?];
    const rgb = parseColorAlpha(colorValue);
    if (!rgb) throw new Error(`${where} has a colour that does not parse: ${colorValue}`);
    return {
      color: {
        colorSpace: "srgb",
        components: rgb.rgb.map((c) => Number(c.toFixed(4))),
        alpha: Number(rgb.alpha.toFixed(4)),
      },
      offsetX: { $type: "dimension", ...lengthOf(x, where) },
      offsetY: { $type: "dimension", ...lengthOf(y, where) },
      blur: { $type: "dimension", ...lengthOf(blur, where) },
      spread: { $type: "dimension", ...lengthOf(spread, where) },
      ...(inset ? { inset: true } : {}),
    };
  });
  return { $type: "shadow", $value: layers.length === 1 ? layers[0] : layers };
}

function splitTop(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "," && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function motionToken(key: string, value: string): Record<string, unknown> {
  if (key.startsWith("duration")) {
    const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(value.trim());
    if (!match) throw new Error(`motion.${key} is ${value}, durations must use ms or s`);
    return { $type: "duration", $value: { value: Number(match[1]), unit: match[2] } };
  }
  const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(value.trim());
  const numbers = bezier?.[1]?.split(",").map((n) => Number(n.trim()));
  if (!numbers || numbers.length !== 4 || numbers.some(Number.isNaN)) {
    throw new Error(`motion.${key} is ${value}, easings must be a cubic-bezier of four numbers`);
  }
  return { $type: "cubicBezier", $value: numbers };
}

export function exportDtcg(source: string): string {
  const t = collect(source);
  const color: Record<string, unknown> = {};
  for (const [key, value] of t.colors) color[key] = colorToken(value);
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
  const shadow = Object.fromEntries(
    t.shadows.map(([key, value]) => [key, shadowToken(value, `elevation.${key}`)]),
  );
  const motionTokens = Object.fromEntries(t.motion.map(([k, v]) => [k, motionToken(k, v)]));
  const dark = t.darkColors.length
    ? {
        color: Object.fromEntries(t.darkColors.map(([k, v]) => [k, colorToken(v)])),
        shadow: Object.fromEntries(
          t.darkShadows.map(([k, v]) => [k, shadowToken(v, `themes.dark.elevation.${k}`)]),
        ),
      }
    : undefined;
  return `${JSON.stringify(
    {
      color,
      fontFamily,
      fontSize: dimensions("typography", t.sizes),
      radius: dimensions("rounded", t.radii),
      spacing: dimensions("spacing", t.spaces),
      ...(t.shadows.length ? { shadow } : {}),
      ...(t.motion.length ? { motion: motionTokens } : {}),
      ...(dark ? { theme: { dark } } : {}),
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
