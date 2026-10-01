export type Rgb = [number, number, number];

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function hex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (!match) return null;
  let digits = match[1] ?? "";
  if (digits.length === 3 || digits.length === 4) digits = [...digits].map((c) => c + c).join("");
  if (digits.length !== 6 && digits.length !== 8) return null;
  return [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16) / 255) as Rgb;
}

function numbers(inner: string): number[] | null {
  const parts = inner.replace(/[,/]/g, " ").trim().split(/\s+/);
  const values = parts.map((part) => {
    if (part.endsWith("%")) return Number(part.slice(0, -1)) / 100;
    return Number(part.replace(/deg$/, ""));
  });
  return values.some(Number.isNaN) ? null : values;
}

function rgbFn(value: string): Rgb | null {
  const match = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (!match) return null;
  const parts = (match[1] ?? "").replace(/[,/]/g, " ").trim().split(/\s+/).slice(0, 3);
  const channels = parts.map((p) =>
    p.endsWith("%") ? Number(p.slice(0, -1)) / 100 : Number(p) / 255,
  );
  return channels.length === 3 && !channels.some(Number.isNaN)
    ? (channels.map(clamp) as Rgb)
    : null;
}

function hslFn(value: string): Rgb | null {
  const match = /^hsla?\(([^)]+)\)$/i.exec(value.trim());
  if (!match) return null;
  const parts = numbers(match[1] ?? "");
  if (!parts || parts.length < 3) return null;
  const h = (((parts[0] ?? 0) % 360) + 360) % 360;
  const s = clamp(parts[1] ?? 0);
  const l = clamp(parts[2] ?? 0);
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

const encode = (linear: number) =>
  clamp(linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);

function oklchFn(value: string): Rgb | null {
  const match = /^oklch\(([^)]+)\)$/i.exec(value.trim());
  if (!match) return null;
  const parts = numbers(match[1] ?? "");
  if (!parts || parts.length < 3) return null;
  const l = parts[0] ?? 0;
  const c = parts[1] ?? 0;
  const h = ((parts[2] ?? 0) * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encode(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    encode(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    encode(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

export function parseColor(value: string): Rgb | null {
  return hex(value) ?? rgbFn(value) ?? hslFn(value) ?? oklchFn(value);
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
