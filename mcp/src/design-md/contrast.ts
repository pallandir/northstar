import { clampRgb, converter, formatHex, parse, wcagContrast } from "culori";

export type Rgb = [number, number, number];

export interface ColorAlpha {
  rgb: Rgb;
  alpha: number;
}

const toRgb = converter("rgb");

const asColor = ([r, g, b]: Rgb) => ({ mode: "rgb" as const, r, g, b });

export function parseColorAlpha(value: string): ColorAlpha | null {
  const parsed = parse(value.trim());
  if (!parsed) return null;
  const { r, g, b, alpha } = clampRgb(toRgb(parsed));
  return { rgb: [r, g, b], alpha: alpha ?? 1 };
}

export function parseColor(value: string): Rgb | null {
  return parseColorAlpha(value)?.rgb ?? null;
}

export function toHex(rgb: Rgb): string {
  return formatHex(clampRgb(asColor(rgb)));
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  return wcagContrast(asColor(a), asColor(b));
}
