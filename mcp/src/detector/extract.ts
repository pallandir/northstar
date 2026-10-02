import type { Decl, Kind, Str } from "./types.js";

const CSS_EXT = new Set([".css", ".scss", ".sass", ".less"]);
const MARKUP_EXT = new Set([".html", ".htm"]);
const COMPONENT_EXT = new Set([
  ".jsx",
  ".tsx",
  ".js",
  ".ts",
  ".mjs",
  ".mts",
  ".cts",
  ".vue",
  ".svelte",
  ".astro",
  ".mdx",
]);

export function kindOf(path: string): Kind | null {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  if (CSS_EXT.has(ext)) return "css";
  if (MARKUP_EXT.has(ext)) return "markup";
  if (COMPONENT_EXT.has(ext)) return "component";
  return null;
}

export function lineIndex(text: string): (index: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (index) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((starts[mid] ?? 0) <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

export function extractStrings(text: string): Str[] {
  const strings: Str[] = [];
  const pattern =
    /"((?:[^"\\\n]|\\.){1,400})"|(?<!\w)'((?:[^'\\\n]|\\.){1,400})'|`((?:[^`\\]|\\.){1,400})`/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    strings.push({ value, index: match.index, end: match.index + match[0].length });
  }
  return strings;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function splitDeclarations(
  body: string,
  offset: number,
): Array<{ prop: string; value: string; index: number }> {
  const out: Array<{ prop: string; value: string; index: number }> = [];
  let depth = 0;
  let start = 0;
  const flush = (end: number) => {
    const chunk = body.slice(start, end);
    const colon = chunk.indexOf(":");
    if (colon > 0) {
      const prop = chunk.slice(0, colon).trim().toLowerCase();
      if (/^-{0,2}[a-z][a-z0-9-]*$/.test(prop)) {
        out.push({
          prop,
          value: chunk.slice(colon + 1).trim(),
          index: offset + start + chunk.search(/\S/),
        });
      }
    }
  };
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      flush(i);
      start = i + 1;
    }
  }
  flush(body.length);
  return out;
}

export function extractDecls(css: string, offset = 0): Decl[] {
  const clean = stripComments(css);
  const decls: Decl[] = [];
  let block = 0;
  const leaf = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = leaf.exec(clean); match; match = leaf.exec(clean)) {
    const selector = (match[1] ?? "").trim();
    const bodyStart = match.index + (match[0].indexOf("{") + 1);
    block++;
    for (const d of splitDeclarations(match[2] ?? "", offset + bodyStart)) {
      decls.push({ selector, block, prop: d.prop, value: d.value, index: d.index });
    }
  }
  return decls;
}

const camelToKebab = (value: string) => value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function extractEmbeddedDecls(text: string): Decl[] {
  const decls: Decl[] = [];
  const styleBlock = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  for (let match = styleBlock.exec(text); match; match = styleBlock.exec(text)) {
    const inner = match[1] ?? "";
    decls.push(...extractDecls(inner, match.index + match[0].indexOf(inner)));
  }

  const inlineAttr = /\bstyle\s*=\s*"([^"]+)"/gi;
  for (let match = inlineAttr.exec(text); match; match = inlineAttr.exec(text)) {
    const inner = match[1] ?? "";
    const offset = match.index + match[0].indexOf(inner);
    for (const d of splitDeclarations(inner, offset)) {
      decls.push({
        selector: "[style]",
        block: -offset,
        prop: d.prop,
        value: d.value,
        index: d.index,
      });
    }
  }

  const jsxStyle = /\bstyle=\{\{([\s\S]{1,600}?)\}\}/g;
  for (let match = jsxStyle.exec(text); match; match = jsxStyle.exec(text)) {
    const inner = match[1] ?? "";
    const offset = match.index + match[0].indexOf(inner);
    const pair = /([a-zA-Z]+)\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g;
    for (let p = pair.exec(inner); p; p = pair.exec(inner)) {
      decls.push({
        selector: "[style]",
        block: -(offset + 1),
        prop: camelToKebab(p[1] ?? ""),
        value: p[2] ?? p[3] ?? p[4] ?? "",
        index: offset + p.index,
      });
    }
  }
  return decls;
}
