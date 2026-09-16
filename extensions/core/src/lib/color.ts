export function rgbToHex(rgb: string): string {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return "#000000";
  const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${hex(match[1])}${hex(match[2])}${hex(match[3])}`;
}

export function toHex(value: string): string {
  return value.startsWith("#") ? value.toLowerCase() : rgbToHex(value);
}

// A short palette of the colours the page already uses near the target, so recolouring stays
// inside the site's own system rather than reaching for an arbitrary picker. Sampled from the
// target's ancestors and siblings rather than the whole document, which would be both slow and
// mostly irrelevant to this one element.
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
    for (const raw of [computed.color, computed.backgroundColor, computed.borderColor]) {
      if (seen.size >= max) break;
      const hex = toHex(raw);
      if (hex === "#000000" && !raw.startsWith("rgb(0")) continue; // rgbToHex's own "unparsed" fallback
      if (hex === "#ffffff" || raw === "rgba(0, 0, 0, 0)" || raw === "transparent") continue;
      seen.add(hex);
    }
  }
  return Array.from(seen);
}
