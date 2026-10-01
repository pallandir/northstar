export type Rgb = [number, number, number];

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export interface ColorAlpha {
  rgb: Rgb;
  alpha: number;
}

const HUE_UNITS: Record<string, number> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };

function hex(value: string): ColorAlpha | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (!match) return null;
  let digits = match[1] ?? "";
  if (digits.length === 3 || digits.length === 4) digits = [...digits].map((c) => c + c).join("");
  if (digits.length !== 6 && digits.length !== 8) return null;
  const rgb = [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16) / 255) as Rgb;
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
  return { rgb, alpha };
}

function split(inner: string): { parts: string[]; alpha: string | undefined } | null {
  if (/^\s*from\b/i.test(inner)) return null;
  const [main, alpha, extra] = inner.split("/");
  if (extra !== undefined) return null;
  const parts = (main ?? "").replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
  const fourth = parts.length === 4 && alpha === undefined ? parts.pop() : alpha?.trim();
  return { parts, alpha: fourth };
}

function component(part: string, percentBase: number): number {
  if (part.toLowerCase() === "none") return 0;
  if (part.endsWith("%")) return (Number(part.slice(0, -1)) / 100) * percentBase;
  return Number(part);
}

function alphaOf(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  const value = component(raw, 1);
  return Number.isNaN(value) ? null : clamp(value);
}

function hueOf(part: string): number {
  if (part.toLowerCase() === "none") return 0;
  const match = /^(-?[\d.]+)(deg|grad|rad|turn)?$/i.exec(part);
  if (!match) return Number.NaN;
  return Number(match[1]) * (HUE_UNITS[(match[2] ?? "deg").toLowerCase()] ?? 1);
}

function functional(value: string, name: string): { parts: string[]; alpha: number } | null {
  const match = new RegExp(`^${name}\\(([^)]+)\\)$`, "i").exec(value.trim());
  if (!match) return null;
  const fields = split(match[1] ?? "");
  if (!fields || fields.parts.length !== 3) return null;
  const alpha = alphaOf(fields.alpha);
  return alpha === null ? null : { parts: fields.parts, alpha };
}

function rgbFn(value: string): ColorAlpha | null {
  const fn = functional(value, "rgba?");
  if (!fn) return null;
  const channels = fn.parts.map((p) => component(p, 255) / 255);
  return channels.some(Number.isNaN) ? null : { rgb: channels.map(clamp) as Rgb, alpha: fn.alpha };
}

function hslFn(value: string): ColorAlpha | null {
  const fn = functional(value, "hsla?");
  if (!fn) return null;
  const [hue, sat, light] = fn.parts as [string, string, string];
  const h = ((hueOf(hue) % 360) + 360) % 360;
  const percent = (part: string) => {
    const amount = component(part, 1);
    return part.endsWith("%") || part.toLowerCase() === "none" ? amount : amount / 100;
  };
  const s = clamp(percent(sat));
  const l = clamp(percent(light));
  if ([h, s, l].some(Number.isNaN)) return null;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { rgb: [f(0), f(8), f(4)], alpha: fn.alpha };
}

const encode = (linear: number) =>
  clamp(linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);

function oklchFn(value: string): ColorAlpha | null {
  const fn = functional(value, "oklch");
  if (!fn) return null;
  const [lightness, chroma, hue] = fn.parts as [string, string, string];
  const l = component(lightness, 1);
  const c = component(chroma, 0.4);
  const h = (hueOf(hue) * Math.PI) / 180;
  if ([l, c, h].some(Number.isNaN)) return null;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    rgb: [
      encode(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
      encode(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
      encode(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
    ],
    alpha: fn.alpha,
  };
}

export function parseColorAlpha(value: string): ColorAlpha | null {
  return hex(value) ?? rgbFn(value) ?? hslFn(value) ?? oklchFn(value);
}

export function parseColor(value: string): Rgb | null {
  return parseColorAlpha(value)?.rgb ?? null;
}

export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(clamp(c) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}
