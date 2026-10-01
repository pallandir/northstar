const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

export function splitFontStack(value: string): string[] {
  const families: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === ",") {
      families.push(current.trim());
      current = "";
    } else current += char;
  }
  families.push(current.trim());
  return families.filter(Boolean);
}

export function primaryFamily(value: string): string {
  return splitFontStack(value)[0] ?? value.trim();
}

export function isGenericFamily(family: string): boolean {
  return GENERIC.has(family.toLowerCase());
}

export function quoteFamily(family: string): string {
  return isGenericFamily(family) ? family : `"${family.replace(/"/g, '\\"')}"`;
}
