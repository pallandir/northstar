export interface ParsedColor {
  hex: string;
  alpha: number;
}

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/;

function channel(value: number): string {
  return Math.min(255, Math.max(0, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

function parseHex(value: string): ParsedColor | null {
  const body = value.slice(1);
  if (!/^[0-9a-f]+$/i.test(body)) return null;
  const full =
    body.length === 3 || body.length === 4 ? Array.from(body, (c) => c + c).join("") : body;
  if (full.length !== 6 && full.length !== 8) return null;
  const alpha = full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1;
  return { hex: `#${full.slice(0, 6).toLowerCase()}`, alpha };
}

function parseRgb(value: string): ParsedColor | null {
  const match = value.match(RGB);
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
  return {
    hex: `#${channel(Number(match[1]))}${channel(Number(match[2]))}${channel(Number(match[3]))}`,
    alpha,
  };
}

function viaCanvas(value: string): ParsedColor {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error(`cannot read the colour "${value}" without a canvas`);
  ctx.fillStyle = "#000000";
  ctx.fillStyle = value;
  const onBlack = ctx.fillStyle;
  ctx.fillStyle = "#ffffff";
  ctx.fillStyle = value;
  if (ctx.fillStyle !== onBlack) throw new Error(`unreadable colour "${value}"`);
  const parsed = parseHex(onBlack) ?? parseRgb(onBlack);
  if (!parsed) throw new Error(`unreadable colour "${value}"`);
  return parsed;
}

function parseColor(value: string): ParsedColor {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "transparent") return { hex: "#000000", alpha: 0 };
  if (trimmed.startsWith("#")) {
    const parsed = parseHex(trimmed);
    if (!parsed) throw new Error(`unreadable colour "${value}"`);
    return parsed;
  }
  return parseRgb(trimmed) ?? viaCanvas(trimmed);
}

export function toHex(value: string): string {
  return parseColor(value).hex;
}

export function formatColor(value: string): string {
  const { hex, alpha } = parseColor(value);
  if (alpha === 0) return "transparent";
  if (alpha >= 1) return hex;
  return `${hex}${channel(alpha * 255)}`;
}

export function sameColor(a: string, b: string): boolean {
  return formatColor(a) === formatColor(b);
}

export function samplePageColors(el: Element, max = 8): string[] {
  const seen = new Set<string>();
  const candidates: Element[] = [];

  let node: Element | null = el;
  for (let i = 0; i < 8 && node; i++) {
    candidates.push(node);
    if (node.parentElement) candidates.push(...Array.from(node.parentElement.children).slice(0, 6));
    node = node.parentElement;
  }

  for (const candidate of candidates) {
    if (seen.size >= max) break;
    const computed = getComputedStyle(candidate);
    for (const raw of [computed.color, computed.backgroundColor, computed.borderTopColor]) {
      if (seen.size >= max) break;
      const { hex, alpha } = parseColor(raw);
      if (alpha === 0 || hex === "#ffffff") continue;
      seen.add(hex);
    }
  }
  return Array.from(seen);
}
