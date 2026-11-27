import { formatHex, formatHex8, parse } from "culori";

function parseColor(value: string) {
  const color = parse(value.trim());
  if (!color) throw new Error(`unreadable colour "${value}"`);
  return color;
}

export function toHex(value: string): string {
  return formatHex(parseColor(value));
}

export function formatColor(value: string): string {
  const color = parseColor(value);
  const alpha = color.alpha ?? 1;
  if (alpha === 0) return "transparent";
  return alpha >= 1 ? formatHex(color) : formatHex8(color);
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
      const color = parse(raw);
      if (!color || (color.alpha ?? 1) === 0) continue;
      const hex = formatHex(color);
      if (hex !== "#ffffff") seen.add(hex);
    }
  }
  return Array.from(seen);
}
