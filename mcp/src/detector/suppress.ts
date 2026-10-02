import type { AllowEntry } from "./types.js";

export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? "";
    if (char === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        out += "(?:.*/)?";
        i++;
      } else out += ".*";
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export interface CompiledGlobs {
  test(path: string): boolean;
}

export function compileGlobs(globs: string[]): CompiledGlobs {
  const patterns = globs.map(globToRegExp);
  return { test: (path) => patterns.some((pattern) => pattern.test(path)) };
}

export function compileAllow(allow: AllowEntry[]): (rule: string, path: string) => boolean {
  const entries = allow.map((entry) => ({
    rule: entry.rule,
    scope: entry.scope ? globToRegExp(entry.scope) : null,
  }));
  return (rule, path) =>
    entries.some((entry) => entry.rule === rule && (!entry.scope || entry.scope.test(path)));
}

export function allowedInline(rule: string, lines: string[], line: number): boolean {
  const marker = new RegExp(`northstar-allow\\s+${rule}\\b`);
  return [lines[line - 1], lines[line - 2]].some((text) => text !== undefined && marker.test(text));
}
