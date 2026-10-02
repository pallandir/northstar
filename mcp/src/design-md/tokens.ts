import type { Mode, Seeds } from "@northstar/canon";
import { type Rgb, contrastRatio, parseColor, toHex } from "./contrast.js";

export class TokenError extends Error {}

interface TokenFonts {
  heading: string;
  body: string;
  mono: string;
}

export interface TokenInput {
  seeds: Seeds;
  fonts: TokenFonts;
  mode: Mode;
  brand?: string;
}

interface ThemeTokens {
  colors: Record<string, string>;
  elevation: Record<string, string>;
}

interface TypeRole {
  fontFamily: string;
  fontSize: string;
  fontWeight: number;
  lineHeight: number;
  letterSpacing?: string;
}

export interface GeneratedTokens {
  light: ThemeTokens;
  dark: ThemeTokens;
  neutrals: { light: string[]; dark: string[] };
  rounded: Record<string, string>;
  spacing: Record<string, string>;
  typography: Record<string, TypeRole>;
  motion: Record<string, string>;
  notes: string[];
}

const TEXT_TARGET = 7;
const UI_TARGET = 4.5;
const STEP = 0.005;
const HUE_COOL = 255;
const HUE_WARM = 70;
const ACCENT_SHIFT = 150;

function keepBrand(
  brand: string,
  surface: string,
  onCandidates: string[],
): { primary: string; onPrimary: string } | undefined {
  const primary = toHex(rgbFromHex(brand));
  if (contrastRatio(rgbFromHex(primary), rgbFromHex(surface)) < UI_TARGET) return undefined;
  const onPrimary = onCandidates.find(
    (candidate) => contrastRatio(rgbFromHex(candidate), rgbFromHex(primary)) >= UI_TARGET,
  );
  return onPrimary ? { primary, onPrimary } : undefined;
}

const encode = (linear: number) =>
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;

function linearOf(l: number, c: number, hueDeg: number): Rgb {
  const h = (hueDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

function rgbOf(l: number, c: number, hue: number): Rgb {
  let chroma = c;
  let linear = linearOf(l, chroma, hue);
  for (let i = 0; i < 40 && !inGamut(linear); i++) {
    chroma *= 0.92;
    linear = linearOf(l, chroma, hue);
  }
  return linear.map((v) => Math.min(1, Math.max(0, encode(Math.min(1, Math.max(0, v)))))) as Rgb;
}

const hexOf = (l: number, c: number, hue: number) => toHex(rgbOf(l, c, hue));

function rgbFromHex(hex: string): Rgb {
  const parsed = parseColor(hex);
  if (!parsed) throw new TokenError(`internal colour ${hex} did not parse`);
  return parsed;
}

function solve(
  label: string,
  hue: number,
  chroma: number,
  against: string,
  target: number,
  direction: "darker" | "lighter",
  start: number,
): string {
  const bg = rgbFromHex(against);
  const sign = direction === "darker" ? -1 : 1;
  for (let l = start; l >= 0.04 && l <= 0.985; l += sign * STEP) {
    const hex = hexOf(l, chroma, hue);
    if (contrastRatio(rgbFromHex(hex), bg) >= target) return hex;
  }
  throw new TokenError(
    `${label} cannot reach ${target}:1 contrast on ${against} at hue ${Math.round(hue)} and chroma ${chroma}. Lower the chroma, pick another hue, or choose a lighter or darker neutral.`,
  );
}

function neutralTint(seeds: Seeds): { hue: number; chroma: number } {
  switch (seeds.temperature) {
    case "pure":
      return { hue: 0, chroma: 0 };
    case "cool":
      return { hue: HUE_COOL, chroma: 0.012 };
    case "warm":
      return { hue: HUE_WARM, chroma: 0.012 };
    case "brand":
      return { hue: seeds.hue, chroma: Math.min(0.02, seeds.chroma * 0.12) };
  }
}

const LIGHT_RAMP = [0.985, 0.965, 0.94, 0.915, 0.89, 0.86, 0.8, 0.68, 0.55, 0.46, 0.38, 0.22];
const DARK_RAMP = [0.15, 0.18, 0.21, 0.25, 0.29, 0.34, 0.4, 0.52, 0.62, 0.72, 0.84, 0.96];

function rgbString(hex: string, alpha: number): string {
  const [r, g, b] = rgbFromHex(hex).map((v) => Math.round(v * 255)) as [number, number, number];
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

function lightElevation(tint: string): Record<string, string> {
  const a = (alpha: number) => rgbString(tint, alpha);
  return {
    xs: `0 0 0 1px ${a(0.05)}, 0 1px 2px 0 ${a(0.06)}`,
    sm: `0 0 0 1px ${a(0.06)}, 0 1px 2px -1px ${a(0.08)}, 0 2px 4px 0 ${a(0.05)}`,
    md: `0 0 0 1px ${a(0.06)}, 0 2px 4px -1px ${a(0.06)}, 0 6px 12px -2px ${a(0.08)}`,
    lg: `0 0 0 1px ${a(0.07)}, 0 4px 8px -2px ${a(0.08)}, 0 12px 24px -4px ${a(0.12)}`,
    xl: `0 0 0 1px ${a(0.08)}, 0 8px 16px -4px ${a(0.1)}, 0 24px 48px -8px ${a(0.18)}`,
  };
}

function darkElevation(): Record<string, string> {
  const ring = "rgb(255 255 255 / 0.08)";
  const k = (alpha: number) => `rgb(0 0 0 / ${alpha})`;
  return {
    xs: `0 0 0 1px ${ring}, 0 1px 2px 0 ${k(0.3)}`,
    sm: `0 0 0 1px ${ring}, 0 1px 2px -1px ${k(0.4)}, 0 2px 4px 0 ${k(0.3)}`,
    md: `0 0 0 1px ${ring}, 0 2px 4px -1px ${k(0.4)}, 0 6px 12px -2px ${k(0.4)}`,
    lg: `0 0 0 1px ${ring}, 0 4px 8px -2px ${k(0.45)}, 0 12px 24px -4px ${k(0.5)}`,
    xl: `0 0 0 1px ${ring}, 0 8px 16px -4px ${k(0.5)}, 0 24px 48px -8px ${k(0.6)}`,
  };
}

interface Semantic {
  hue: number;
  chroma: number;
}

const PURPLE_BAND: [number, number] = [265, 325];

function accentHue(hue: number): number {
  const shifted = (hue + ACCENT_SHIFT) % 360;
  const [low, high] = PURPLE_BAND;
  if (shifted < low || shifted > high) return shifted;
  return shifted < (low + high) / 2 ? low - 10 : high + 10;
}

function semantics(seeds: Seeds): Record<string, Semantic> {
  return {
    accent: { hue: accentHue(seeds.hue), chroma: Math.min(0.16, seeds.chroma) },
    danger: { hue: 27, chroma: 0.17 },
    success: { hue: 150, chroma: 0.14 },
    warning: { hue: 75, chroma: 0.13 },
  };
}

function buildTheme(
  seeds: Seeds,
  theme: "light" | "dark",
  brand: string | undefined,
  notes: string[],
): { tokens: ThemeTokens; ramp: string[] } {
  const tint = neutralTint(seeds);
  const levels = theme === "light" ? LIGHT_RAMP : DARK_RAMP;
  const ramp = levels.map((l) => hexOf(l, tint.chroma, tint.hue));
  const light = theme === "light";
  const background = ramp[0];
  const surface = light ? hexOf(0.997, tint.chroma * 0.4, tint.hue) : ramp[1];
  const muted = light ? ramp[2] : ramp[3];
  const border = ramp[4];
  if (!background || !surface || !muted || !border) throw new TokenError("neutral ramp is empty");
  const strongest = muted;
  const direction = light ? "darker" : "lighter";
  const textStart = light ? 0.24 : 0.94;
  const softStart = light ? 0.55 : 0.72;
  const text = solve("text", tint.hue, tint.chroma, strongest, TEXT_TARGET, direction, textStart);
  const textSoft = solve(
    "text-soft",
    tint.hue,
    tint.chroma,
    strongest,
    UI_TARGET,
    direction,
    softStart,
  );
  const onCandidates = [
    hexOf(0.99, 0.004, seeds.hue),
    hexOf(0.16, Math.min(0.03, seeds.chroma * 0.2), seeds.hue),
  ];
  const kept = brand ? keepBrand(brand, strongest, onCandidates) : undefined;
  let primary: string;
  let onPrimary: string;
  if (kept) {
    primary = kept.primary;
    onPrimary = kept.onPrimary;
    notes.push(`${theme} primary is the brand colour ${brand} as given`);
  } else {
    primary = solve(
      "primary",
      seeds.hue,
      seeds.chroma,
      strongest,
      UI_TARGET,
      direction,
      light ? 0.58 : 0.66,
    );
    onPrimary = light ? (onCandidates[0] as string) : (onCandidates[1] as string);
    if (brand) {
      notes.push(
        `${theme} primary was derived from the brand colour ${brand}, because the brand itself does not reach ${UI_TARGET}:1 on the ${theme} muted surface with a readable on-primary`,
      );
    }
  }
  if (contrastRatio(rgbFromHex(onPrimary), rgbFromHex(primary)) < UI_TARGET) {
    throw new TokenError(
      `on-primary cannot reach ${UI_TARGET}:1 on primary at hue ${Math.round(seeds.hue)} and chroma ${seeds.chroma}. Lower the chroma or pick another hue.`,
    );
  }
  const colors: Record<string, string> = {
    background,
    surface,
    text,
    "text-soft": textSoft,
    muted,
    border,
    primary,
    "on-primary": onPrimary,
  };
  for (const [role, s] of Object.entries(semantics(seeds))) {
    colors[role] = solve(
      role,
      s.hue,
      s.chroma,
      strongest,
      UI_TARGET,
      direction,
      light ? 0.58 : 0.7,
    );
  }
  const shadowTint = hexOf(0.22, Math.max(0.02, tint.chroma * 2), tint.hue);
  return {
    tokens: { colors, elevation: light ? lightElevation(shadowTint) : darkElevation() },
    ramp,
  };
}

const RADIUS_BASE: Record<Seeds["shape"], number> = { sharp: 2, crisp: 6, soft: 10, round: 16 };

function rounded(shape: Seeds["shape"]): Record<string, string> {
  const base = RADIUS_BASE[shape];
  return {
    sm: `${base}px`,
    md: `${base + 4}px`,
    lg: `${base + 8}px`,
    xl: `${base + 16}px`,
    full: "9999px",
  };
}

const SPACING: Record<Seeds["density"], Record<string, string>> = {
  airy: { unit: "4px", xs: "8px", sm: "12px", md: "20px", lg: "32px", xl: "56px" },
  balanced: { unit: "4px", xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "40px" },
  dense: { unit: "4px", xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px" },
};

const DISPLAY: Record<Mode, string> = {
  operate: "2.5rem",
  read: "3rem",
  persuade: "4.5rem",
  experience: "6rem",
};
const HEADING: Record<Mode, string> = {
  operate: "1.5rem",
  read: "2rem",
  persuade: "2.25rem",
  experience: "2.5rem",
};

function typography(input: TokenInput): Record<string, TypeRole> {
  const { fonts, seeds, mode } = input;
  const dense = seeds.density === "dense";
  return {
    display: {
      fontFamily: fonts.heading,
      fontSize: DISPLAY[mode],
      fontWeight: 600,
      lineHeight: 1.05,
      letterSpacing: "-0.03em",
    },
    heading: {
      fontFamily: fonts.heading,
      fontSize: HEADING[mode],
      fontWeight: 600,
      lineHeight: 1.15,
      letterSpacing: "-0.02em",
    },
    subheading: {
      fontFamily: fonts.heading,
      fontSize: dense ? "1.0625rem" : "1.125rem",
      fontWeight: 600,
      lineHeight: 1.3,
      letterSpacing: "-0.005em",
    },
    body: {
      fontFamily: fonts.body,
      fontSize: dense ? "0.875rem" : "1rem",
      fontWeight: 400,
      lineHeight: dense ? 1.5 : 1.6,
    },
    label: {
      fontFamily: fonts.body,
      fontSize: dense ? "0.75rem" : "0.8125rem",
      fontWeight: 500,
      lineHeight: 1.3,
      letterSpacing: "0.01em",
    },
    caption: {
      fontFamily: fonts.body,
      fontSize: "0.75rem",
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: "0.02em",
    },
    code: {
      fontFamily: fonts.mono,
      fontSize: "0.875rem",
      fontWeight: 400,
      lineHeight: 1.5,
    },
  };
}

const DURATIONS: Record<Seeds["feel"], [number, number, number, number]> = {
  snappy: [100, 140, 200, 280],
  calm: [120, 180, 240, 320],
  expressive: [160, 240, 320, 480],
};

function motion(feel: Seeds["feel"]): Record<string, string> {
  const [fast, base, slow, drawer] = DURATIONS[feel];
  return {
    "duration-fast": `${fast}ms`,
    "duration-base": `${base}ms`,
    "duration-slow": `${slow}ms`,
    "duration-drawer": `${drawer}ms`,
    "ease-out": "cubic-bezier(0.23, 1, 0.32, 1)",
    "ease-in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
    "ease-drawer": "cubic-bezier(0.32, 0.72, 0, 1)",
  };
}

export function generateTokens(input: TokenInput): GeneratedTokens {
  const { seeds } = input;
  if (!(seeds.chroma > 0 && seeds.chroma <= 0.3)) {
    throw new TokenError(
      `chroma ${seeds.chroma} is outside 0 to 0.3, use 0.08 to 0.2 for brand colours`,
    );
  }
  if (seeds.hue < 0 || seeds.hue > 360)
    throw new TokenError(`hue ${seeds.hue} is outside 0 to 360`);
  const notes: string[] = [];
  const light = buildTheme(seeds, "light", input.brand, notes);
  const dark = buildTheme(seeds, "dark", input.brand, notes);
  return {
    light: light.tokens,
    dark: dark.tokens,
    neutrals: { light: light.ramp, dark: dark.ramp },
    rounded: rounded(seeds.shape),
    spacing: { ...SPACING[seeds.density] },
    typography: typography(input),
    motion: motion(seeds.feel),
    notes,
  };
}

function oklabOf(hex: string): { a: number; b: number } {
  const rgb = parseColor(hex);
  if (!rgb) throw new TokenError(`${hex} is not a valid colour, pass a hex such as #3b5bdb`);
  const [r, g, b] = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function hueOfHex(hex: string): number {
  const { a, b } = oklabOf(hex);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

export function chromaOfHex(hex: string): number {
  const { a, b } = oklabOf(hex);
  return Math.hypot(a, b);
}
