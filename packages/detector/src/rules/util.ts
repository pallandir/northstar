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
