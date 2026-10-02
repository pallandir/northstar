export class ConfigError extends Error {}

const BLOCK_BEGIN = "<!-- northstar:begin -->";
const BLOCK_END = "<!-- northstar:end -->";

type Json = Record<string, unknown>;

export function parseJsonObject(text: string | undefined, label: string): Json {
  if (!text || !text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(
      `${label} is not valid JSON (${(err as Error).message}), fix it or merge by hand`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`${label} must contain a JSON object`);
  }
  return value as Json;
}

export function writeJson(value: Json): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function child(parent: Json, key: string): Json {
  const existing = parent[key];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) return existing as Json;
  const created: Json = {};
  parent[key] = created;
  return created;
}

export function prune(parent: Json, key: string): void {
  const value = parent[key];
  const empty = Array.isArray(value)
    ? value.length === 0
    : value && typeof value === "object" && Object.keys(value as Json).length === 0;
  if (empty) delete parent[key];
}

interface HookCommand {
  type: "command";
  command: string;
  name?: string;
  timeout?: number;
  statusMessage?: string;
}

export interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

const OWN_COMMAND = /\bhook\s+(pre|post)-edit\s+--agent\s+(claude|codex|cursor|gemini|opencode)\b/;
const OWN_NAME = "northstar-scan";

function isOwnHook(hook: HookCommand): boolean {
  return hook.name === OWN_NAME || OWN_COMMAND.test(hook.command ?? "");
}

function ownHooks(entry: HookEntry): HookCommand[] {
  return (entry.hooks ?? []).filter(isOwnHook);
}

function withoutOwn(list: HookEntry[]): HookEntry[] {
  return list.flatMap((entry) => {
    if (ownHooks(entry).length === 0) return [entry];
    const hooks = (entry.hooks ?? []).filter((hook) => !isOwnHook(hook));
    return hooks.length ? [{ ...entry, hooks }] : [];
  });
}

export function upsertHook(root: Json, event: string, entry: HookEntry): void {
  const hooks = child(root, "hooks");
  const list = Array.isArray(hooks[event]) ? (hooks[event] as HookEntry[]) : [];
  const result: HookEntry[] = [];
  let placed = false;
  for (const existing of list) {
    if (ownHooks(existing).length === 0) {
      result.push(existing);
      continue;
    }
    result.push(...withoutOwn([existing]));
    if (!placed) {
      result.push(entry);
      placed = true;
    }
  }
  if (!placed) result.push(entry);
  hooks[event] = result;
}

export function removeHook(root: Json, event: string): void {
  const hooks = root.hooks as Json | undefined;
  if (!hooks || !Array.isArray(hooks[event])) return;
  hooks[event] = withoutOwn(hooks[event] as HookEntry[]);
  prune(hooks, event);
  prune(root, "hooks");
}

function isTableHeader(line: string): boolean {
  return /^\s*\[/.test(line);
}

const COMMENT_OR_BLANK = /^\s*(#.*)?$/;

export function removeTomlTables(text: string, table: string): string {
  const own = new RegExp(`^\\s*\\[${table.replace(/\./g, "\\.")}(\\..+)?\\]\\s*$`);
  const lines = text.split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    if (!(isTableHeader(line) && own.test(line))) {
      out.push(line);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < lines.length && !isTableHeader(lines[end] as string)) end += 1;
    let lastBody = end - 1;
    while (lastBody > index && COMMENT_OR_BLANK.test(lines[lastBody] as string)) lastBody -= 1;
    for (const kept of lines.slice(lastBody + 1, end)) {
      if (kept.trim() !== "") out.push(kept);
    }
    index = end;
    if (out.length && (out[out.length - 1] as string).trim() === "") {
      while (index < lines.length && (lines[index] as string).trim() === "") index += 1;
    }
  }
  return out.join("\n");
}

export function upsertToml(text: string | undefined, table: string, body: string): string {
  const base = removeTomlTables(text ?? "", table).trimEnd();
  return `${base ? `${base}\n\n` : ""}${body.trim()}\n`;
}

export function upsertBlock(text: string | undefined, content: string): string {
  const block = `${BLOCK_BEGIN}\n${content.trim()}\n${BLOCK_END}`;
  const base = text ?? "";
  const start = base.indexOf(BLOCK_BEGIN);
  const end = base.indexOf(BLOCK_END);
  if (start !== -1 && end > start) {
    return `${base.slice(0, start)}${block}${base.slice(end + BLOCK_END.length)}`;
  }
  const trimmed = base.trimEnd();
  return `${trimmed ? `${trimmed}\n\n` : ""}${block}\n`;
}

export function removeBlock(text: string): string {
  const start = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end < start) return text;
  const head = text.slice(0, start).trimEnd();
  const tail = text.slice(end + BLOCK_END.length).trimStart();
  return [head, tail]
    .filter(Boolean)
    .join("\n\n")
    .concat(head || tail ? "\n" : "");
}
