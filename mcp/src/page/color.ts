import { contrastRatio, toHex } from "../design-md/index.js";
import type { Rgba } from "./snapshot.js";

const rgb = (c: Rgba): [number, number, number] => [c[0] / 255, c[1] / 255, c[2] / 255];

export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [
    Math.round(top[0] * a + under[0] * (1 - a)),
    Math.round(top[1] * a + under[1] * (1 - a)),
    Math.round(top[2] * a + under[2] * (1 - a)),
    1,
  ];
}

export function ratio(a: Rgba, b: Rgba): number {
  return contrastRatio(rgb(a), rgb(b));
}

export function hex(c: Rgba): string {
  return toHex(rgb(c));
}

export function saturationOf([r, g, b]: Rgba): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const lightness = (max + min) / 2;
  return (max - min) / (1 - Math.abs(2 * lightness - 1));
}

export function hueOf([r, g, b]: Rgba): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (hue * 60 + 360) % 360;
}

export function lightnessOf([r, g, b]: Rgba): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}
