import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import type { AgentName } from "@northstar/adapters";
import { z } from "zod";
import { installedPluginIds } from "./plugin.js";
import { readRecord } from "./record.js";

export type ConflictKind = "skill" | "agent" | "plugin";

export interface Conflict {
  kind: ConflictKind;
  name: string;
  owner: "claude" | "shared" | AgentName;
  path?: string;
  id?: string;
  broken: boolean;
}

const CONFLICT_SKILLS = [
  "impeccable",
  "wondelai-top-design",
  "frontend-design",
  "ui-ux-pro-max",
  "design-taste-frontend",
  "high-end-visual-design",
  "minimalist-ui",
  "redesign-existing-projects",
  "make-interfaces-feel-better",
  "emil-design-eng",
];
const CONFLICT_AGENT_PREFIX = "impeccable-";
const CONFLICT_PLUGINS = [
  "ui-ux-pro-max@ui-ux-pro-max-skill",
  "frontend-design@claude-plugins-official",
];
const CONFLICT_PLUGIN_PREFIX = "impeccable@";

const SKILL_ROOTS: Array<[Conflict["owner"], string]> = [
  ["claude", ".claude/skills"],
  ["shared", ".agents/skills"],
  ["cursor", ".cursor/skills"],
  ["codex", ".codex/skills"],
  ["gemini", ".gemini/skills"],
  ["opencode", ".config/opencode/skills"],
];

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

function isBroken(path: string): boolean {
  return exists(path) && !existsSync(path);
}

function mentionsNorthstar(skillDir: string): boolean {
  try {
    return /northstar/i.test(readFileSync(join(skillDir, "SKILL.md"), "utf8"));
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

export function findConflicts(home: string): Conflict[] {
  const found: Conflict[] = [];

  for (const [owner, rel] of SKILL_ROOTS) {
    const base = join(home, rel);
    if (!existsSync(base)) continue;
    for (const name of [...CONFLICT_SKILLS, "resolve-comments"]) {
      const path = join(base, name);
      if (!exists(path)) continue;
      if (name === "resolve-comments" && !mentionsNorthstar(path)) continue;
      found.push({ kind: "skill", name, owner, path, broken: isBroken(path) });
    }
  }

  const agents = join(home, ".claude", "agents");
  if (existsSync(agents)) {
    for (const file of readdirSync(agents).sort()) {
      if (file.startsWith(CONFLICT_AGENT_PREFIX) && file.endsWith(".md")) {
        found.push({
          kind: "agent",
          name: file,
          owner: "claude",
          path: join(agents, file),
          broken: false,
        });
      }
    }
  }

  for (const id of installedPluginIds(home)) {
    if (CONFLICT_PLUGINS.includes(id) || id.startsWith(CONFLICT_PLUGIN_PREFIX)) {
      found.push({ kind: "plugin", name: id, owner: "claude", id, broken: false });
    }
  }
  return found;
}

export function installedFor(home: string, conflict: Conflict): boolean {
  const installs = Object.values(readRecord(home).installs);
  if (conflict.owner === "shared") return installs.some((entry) => entry.agent !== "claude");
  return installs.some((entry) => entry.agent === conflict.owner);
}

export type Runner = (command: string, args: string[]) => void;

interface QuarantineEntry {
  from: string;
  to: string;
  kind: ConflictKind;
  name: string;
}

function move(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    rmSync(from, { recursive: true, force: true });
  }
}

const STAMP = /^[\w][\w.-]*$/;

function assertStamp(stamp: string): void {
  if (!STAMP.test(stamp) || stamp.includes("..")) {
    throw new Error(
      `${stamp} is not a valid quarantine name, use letters, digits, dots and dashes`,
    );
  }
}

export function quarantineDir(home: string, stamp: string): string {
  assertStamp(stamp);
  return join(home, ".northstar", "quarantine", stamp);
}

const entrySchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["skill", "agent", "plugin"]),
  name: z.string(),
});

export function remove(
  home: string,
  conflicts: Conflict[],
  stamp: string,
  run: Runner,
): { moved: QuarantineEntry[]; uninstalled: string[]; failed: string[] } {
  const base = quarantineDir(home, stamp);
  const moved: QuarantineEntry[] = [];
  const uninstalled: string[] = [];
  const failed: string[] = [];

  for (const conflict of conflicts) {
    try {
      if (conflict.kind === "plugin" && conflict.id) {
        run("claude", ["plugin", "uninstall", conflict.id]);
        uninstalled.push(conflict.id);
      } else if (conflict.path) {
        const to = join(base, conflict.owner, conflict.kind, conflict.name);
        move(conflict.path, to);
        moved.push({ from: conflict.path, to, kind: conflict.kind, name: conflict.name });
        writeFileSync(join(base, "manifest.json"), `${JSON.stringify(moved, null, 2)}\n`);
      }
    } catch (err) {
      failed.push(`${conflict.name}: ${(err as Error).message}`);
    }
  }
  return { moved, uninstalled, failed };
}

export function restore(home: string, stamp: string): { restored: string[]; failed: string[] } {
  const dir = quarantineDir(home, stamp);
  const manifest = join(dir, "manifest.json");
  if (!existsSync(manifest)) throw new Error(`no quarantine named ${stamp}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (err) {
    throw new Error(
      `${manifest} is not valid JSON (${(err as Error).message}), restore by hand from ${dir}`,
    );
  }
  const parsed = z.array(entrySchema).safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${manifest} is corrupt (${parsed.error.issues[0]?.message}), restore by hand from ${dir}`,
    );
  }
  const restored: string[] = [];
  const failed: string[] = [];
  for (const entry of parsed.data) {
    try {
      if (!entry.to.startsWith(`${dir}${sep}`)) throw new Error("entry is outside the quarantine");
      if (!entry.from.startsWith(`${home}${sep}`))
        throw new Error("destination is outside the home directory");
      if (exists(entry.from)) throw new Error("destination already exists");
      move(entry.to, entry.from);
      restored.push(entry.from);
    } catch (err) {
      failed.push(`${entry.name}: ${(err as Error).message}`);
    }
  }
  return { restored, failed };
}
