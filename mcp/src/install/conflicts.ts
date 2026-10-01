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
import { dirname, join } from "node:path";
import { AGENTS, type AgentName, readRecord } from "./record.js";

export type ConflictKind = "skill" | "agent" | "plugin";

export interface Conflict {
  kind: ConflictKind;
  name: string;
  owner: "claude" | "shared" | AgentName;
  path?: string;
  id?: string;
  broken: boolean;
}

export const CONFLICT_SKILLS = [
  "impeccable",
  "wondelai-top-design",
  "frontend-design",
  "ui-ux-pro-max",
];
export const CONFLICT_AGENT_PREFIX = "impeccable-";
export const CONFLICT_PLUGINS = [
  "ui-ux-pro-max@ui-ux-pro-max-skill",
  "frontend-design@claude-plugins-official",
];
export const CONFLICT_PLUGIN_PREFIX = "impeccable@";

const SKILL_ROOTS: Array<[Conflict["owner"], string]> = [
  ["claude", ".claude/skills"],
  ["shared", ".agents/skills"],
  ["cursor", ".cursor/skills"],
  ["codex", ".codex/skills"],
  ["gemini", ".gemini/skills"],
  ["opencode", ".config/opencode/skills"],
];

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isBroken(path: string): boolean {
  return exists(path) && !existsSync(path);
}

function mentionsNorthstar(skillDir: string): boolean {
  try {
    return /northstar/i.test(readFileSync(join(skillDir, "SKILL.md"), "utf8"));
  } catch {
    return false;
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

  const installed = join(home, ".claude", "plugins", "installed_plugins.json");
  if (existsSync(installed)) {
    try {
      const data = JSON.parse(readFileSync(installed, "utf8")) as {
        plugins?: Record<string, unknown>;
      };
      for (const id of Object.keys(data.plugins ?? {}).sort()) {
        if (CONFLICT_PLUGINS.includes(id) || id.startsWith(CONFLICT_PLUGIN_PREFIX)) {
          found.push({ kind: "plugin", name: id, owner: "claude", id, broken: false });
        }
      }
    } catch {}
  }
  return found;
}

export function installedFor(home: string, conflict: Conflict): boolean {
  const agents = Object.keys(readRecord(home).agents) as AgentName[];
  if (conflict.owner === "shared") return agents.some((agent) => agent !== "claude");
  return agents.includes(conflict.owner);
}

export type Runner = (command: string, args: string[]) => void;

export interface QuarantineEntry {
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

export function quarantineDir(home: string, stamp: string): string {
  return join(home, ".northstar", "quarantine", stamp);
}

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
      }
    } catch (err) {
      failed.push(`${conflict.name}: ${(err as Error).message}`);
    }
  }
  if (moved.length) {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "manifest.json"), `${JSON.stringify(moved, null, 2)}\n`);
  }
  return { moved, uninstalled, failed };
}

export function restore(home: string, stamp: string): { restored: string[]; failed: string[] } {
  const manifest = join(quarantineDir(home, stamp), "manifest.json");
  if (!existsSync(manifest)) throw new Error(`no quarantine named ${stamp}`);
  const entries = JSON.parse(readFileSync(manifest, "utf8")) as QuarantineEntry[];
  const restored: string[] = [];
  const failed: string[] = [];
  for (const entry of entries) {
    try {
      if (exists(entry.from)) throw new Error("destination already exists");
      move(entry.to, entry.from);
      restored.push(entry.from);
    } catch (err) {
      failed.push(`${entry.name}: ${(err as Error).message}`);
    }
  }
  return { restored, failed };
}

export const KNOWN_AGENTS: readonly string[] = AGENTS;
