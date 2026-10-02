export interface OpenTag {
  name: string;
  index: number;
  end: number;
  attrs: string;
  selfClosing: boolean;
}

const MAX_TAG = 4000;
const NAME_START = /[A-Za-z]/;

function skipQuoted(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") i += 2;
    else if (text[i] === quote) return i + 1;
    else i++;
  }
  return text.length;
}

function readTag(text: string, start: number): OpenTag | null {
  let i = start + 1;
  const nameStart = i;
  while (i < text.length && /[\w.:-]/.test(text[i] ?? "")) i++;
  const name = text.slice(nameStart, i);
  const attrsStart = i;
  let depth = 0;
  const limit = Math.min(text.length, start + MAX_TAG);
  while (i < limit) {
    const char = text[i];
    if (char === '"' || char === "'" || (char === "`" && depth > 0)) {
      i = skipQuoted(text, i, char);
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") depth = Math.max(0, depth - 1);
    else if (char === "<" && depth === 0) return null;
    else if (char === ">" && depth === 0) {
      const raw = text.slice(attrsStart, i);
      const selfClosing = raw.trimEnd().endsWith("/");
      return { name, index: start, end: i, attrs: raw, selfClosing };
    }
    i++;
  }
  return null;
}

export function openTags(text: string, names?: ReadonlySet<string>): OpenTag[] {
  const tags: OpenTag[] = [];
  for (let i = text.indexOf("<"); i !== -1; i = text.indexOf("<", i + 1)) {
    if (!NAME_START.test(text[i + 1] ?? "")) continue;
    const tag = readTag(text, i);
    if (!tag || (names && !names.has(tag.name.toLowerCase()))) continue;
    tags.push(tag);
  }
  return tags;
}

function maskAttrs(attrs: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < attrs.length; i++) {
    const char = attrs[i] ?? "";
    if (char === '"' || char === "'") {
      const end = skipQuoted(attrs, i, char);
      out += char + " ".repeat(Math.max(0, end - i - 2)) + (end - i >= 2 ? char : "");
      i = end - 1;
    } else if (char === "{") {
      depth++;
      out += depth === 1 ? "{" : " ";
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
      out += depth === 0 ? "}" : " ";
    } else out += depth > 0 ? " " : char;
  }
  return out;
}

export function hasAttr(tag: OpenTag, pattern: RegExp): boolean {
  return pattern.test(maskAttrs(tag.attrs));
}

export function realTagEnds(text: string): Set<number> {
  return new Set(openTags(text).map((tag) => tag.end));
}
