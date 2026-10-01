import type { AllowEntry } from "./types.js";

export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? "";
    if (char === "*" && glob[i + 1] === "*") {
      out += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

export function allowedByConfig(rule: string, path: string, allow: AllowEntry[]): boolean {
  return allow.some(
    (entry) => entry.rule === rule && (!entry.scope || globToRegExp(entry.scope).test(path)),
  );
}

export function allowedInline(rule: string, lines: string[], line: number): boolean {
  const marker = new RegExp(`northstar-allow\\s+${rule}\\b`);
  return [lines[line - 1], lines[line - 2]].some((text) => text !== undefined && marker.test(text));
}
