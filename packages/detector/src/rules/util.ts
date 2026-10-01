import type { Ctx, Decl, Str } from "../types.js";

export const variantless = (token: string): string =>
  token.replace(/^(?:[\w-]+:|\[[^\]]+\]:)+/, "").replace(/^!/, "");

export function toks(value: string): string[] {
  return value.split(/\s+/).filter(Boolean).map(variantless);
}

export function classLists(ctx: Ctx): Array<{ str: Str; tokens: string[] }> {
  return ctx.strings
    .filter((s) => /[a-z]/.test(s.value) && s.value.length <= 400)
    .map((str) => ({ str, tokens: toks(str.value) }));
}

export const isCapsLabel = (tokens: string[]): boolean =>
  tokens.includes("uppercase") &&
  tokens.some((t) => /^tracking-(wide|wider|widest)$/.test(t)) &&
  tokens.some((t) => /^text-(xs|sm)$/.test(t));

export const HEADING_AHEAD = /<h[1-3]\b|text-(3|4|5|6|7|8|9)xl/;

export function importSpecifiers(text: string): string[] {
  const pattern = /(?:\bfrom\s+|\bimport\s+|\brequire\(\s*|\bimport\(\s*)["']([^"'\n]+)["']/g;
  return [...text.matchAll(pattern)].map((m) => m[1] ?? "");
}

export function importsAny(text: string, packages: readonly string[]): boolean {
  const specifiers = importSpecifiers(text);
  return specifiers.some((spec) =>
    packages.some(
      (name) =>
        spec === name ||
        spec.startsWith(`${name}/`) ||
        (name.endsWith("/") && spec.startsWith(name)),
    ),
  );
}

export function blocks(decls: Decl[]): Decl[][] {
  const groups = new Map<number, Decl[]>();
  for (const decl of decls) groups.set(decl.block, [...(groups.get(decl.block) ?? []), decl]);
  return [...groups.values()];
}

export const HEADING_SELECTOR = /(^|[\s,>.#])h[1-3]\b|display|hero|headline|heading|title/i;

const REM_BY_TAILWIND: Record<string, number> = {
  "5xl": 3,
  "6xl": 3.75,
  "7xl": 4.5,
  "8xl": 6,
  "9xl": 8,
};

export function tailwindRem(size: string): number | undefined {
  return REM_BY_TAILWIND[size];
}

export function parseRem(value: string): number {
  const last = /clamp\(([^)]*)\)/i.exec(value);
  const target = last ? ((last[1] ?? "").split(",").pop()?.trim() ?? "") : value.trim();
  const match = /^(-?[\d.]+)(rem|em|px)$/.exec(target);
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  return match[2] === "px" ? amount / 16 : amount;
}

export function commaParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth = Math.max(0, depth - 1);
    else if (value[i] === "," && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}
