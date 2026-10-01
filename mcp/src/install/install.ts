import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  type AgentName,
  type AgentPlan,
  type Op,
  type Packs,
  type PlanContext,
  type Scope,
  planAgent,
} from "@northstar/adapters";
import { canonRoot, skillRoot } from "../assets.js";
import { VERSION } from "../config.js";
import type { Runner } from "./conflicts.js";
import {
  type AgentRecord,
  type InstalledFile,
  readRecord,
  recordKey,
  writeRecord,
} from "./record.js";

export interface InstallOptions {
  agents: AgentName[];
  scope: Scope;
  packs: Packs;
  home: string;
  project: string;
  dryRun: boolean;
  run: Runner;
  stamp?: string;
  bin?: string;
  gate?: boolean;
  plugin?: boolean;
}

export type Status = "created" | "updated" | "unchanged" | "planned" | "failed";

export interface OpResult {
  agent: AgentName;
  label: string;
  target: string;
  status: Status;
  detail?: string;
}

export interface InstallOutcome {
  results: OpResult[];
  notes: string[];
}

export function contextFor(
  agent: AgentName,
  options: Pick<InstallOptions, "scope" | "packs" | "home" | "project" | "bin" | "gate" | "plugin">,
): PlanContext {
  const root = canonRoot();
  return {
    agent,
    scope: options.scope,
    home: options.home,
    project: options.project,
    version: VERSION,
    packs: options.packs,
    snippet: readFileSync(join(root, "snippets", "agents-md.md"), "utf8"),
    critic: readFileSync(join(root, "agents", "critic.md"), "utf8"),
    launch: options.bin ? { command: "node", args: [options.bin] } : undefined,
    gate: options.gate,
    plugin: agent === "claude" && options.scope === "user" && options.plugin === true,
  };
}

export function contextForRecord(
  entry: AgentRecord,
  home: string,
  project: string,
  plugin = false,
): PlanContext {
  return contextFor(entry.agent, {
    scope: entry.scope,
    packs: entry.packs,
    home,
    project: entry.project ?? project,
    bin: entry.bin,
    gate: entry.gate,
    plugin,
  });
}

function target(op: Op): string {
  return op.kind === "command" ? op.run.join(" ") : op.path;
}

function backupOf(path: string, stamp: string): string {
  const backup = `${path}.northstar-bak-${stamp}`;
  cpSync(path, backup);
  return backup;
}

function backupDirOf(home: string, path: string, stamp: string): string {
  const backup = join(home, ".northstar", "backups", stamp, path.replace(/[^\w.-]+/g, "_"));
  mkdirSync(dirname(backup), { recursive: true });
  cpSync(path, backup, { recursive: true, verbatimSymlinks: true });
  return backup;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    })
    .sort();
}

export function treeHash(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const hash = createHash("sha256");
  for (const file of filesUnder(dir)) {
    hash.update(relative(dir, file).split("\\").join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function resetRegistration(run: Runner, reset: string[]): void {
  try {
    run(reset[0] as string, reset.slice(1));
  } catch (err) {
    const detail = `${(err as Error).message} ${String((err as { stderr?: unknown }).stderr ?? "")}`;
    if (!/no mcp server|not found/i.test(detail)) throw err;
  }
}

export function install(options: InstallOptions): InstallOutcome {
  const stamp = options.stamp ?? new Date().toISOString().replace(/[:.]/g, "-");
  const plans: AgentPlan[] = options.agents.map((agent) => planAgent(contextFor(agent, options)));
  const results: OpResult[] = [];
  const notes = plans.flatMap((plan) => plan.notes);
  const record = readRecord(options.home);
  const doneSkills = new Set<string>();
  let changed = false;

  for (const plan of plans) {
    const key = recordKey(plan.agent, options.scope, options.project);
    const prior = record.installs[key];
    const known = (path: string) => prior?.files.find((file) => file.path === path);
    const files: InstalledFile[] = [];
    const first = results.length;

    for (const op of plan.ops) {
      const base = { agent: plan.agent, label: op.label, target: target(op) };
      try {
        if (op.kind === "merge" || op.kind === "file") {
          const existed = existsSync(op.path);
          const existing = existed ? readFileSync(op.path, "utf8") : undefined;
          const next = op.kind === "merge" ? op.apply(existing) : op.content;
          const removing = op.kind === "merge" && next.trim() === "";
          if (next === existing || (removing && !existed)) {
            results.push({ ...base, status: "unchanged" });
            if (existed) files.push(known(op.path) ?? { path: op.path, created: false });
            continue;
          }
          if (options.dryRun) {
            results.push({ ...base, status: "planned" });
            continue;
          }
          const was = known(op.path);
          const backup = was ? was.backup : existed ? backupOf(op.path, stamp) : undefined;
          if (removing) {
            rmSync(op.path);
          } else {
            mkdirSync(dirname(op.path), { recursive: true });
            writeFileSync(op.path, next);
          }
          results.push({
            ...base,
            status: existed ? "updated" : "created",
            detail: removing ? "removed" : backup,
          });
          if (!removing)
            files.push({ path: op.path, created: was ? was.created : !existed, backup });
        } else if (op.kind === "skill") {
          if (doneSkills.has(op.path)) {
            results.push({ ...base, status: "unchanged", detail: "shared with another agent" });
            continue;
          }
          doneSkills.add(op.path);
          const source = skillRoot();
          const existed = existsSync(op.path);
          const was = known(op.path);
          if (treeHash(source) === treeHash(op.path)) {
            results.push({ ...base, status: "unchanged" });
            files.push(was ?? { path: op.path, created: false });
            continue;
          }
          if (options.dryRun) {
            results.push({ ...base, status: "planned" });
            continue;
          }
          const backup =
            was?.backup ??
            (existed && !was?.created ? backupDirOf(options.home, op.path, stamp) : undefined);
          rmSync(op.path, { recursive: true, force: true });
          mkdirSync(dirname(op.path), { recursive: true });
          cpSync(source, op.path, { recursive: true });
          results.push({ ...base, status: existed ? "updated" : "created", detail: backup });
          files.push({ path: op.path, created: was ? was.created : !existed, backup });
        } else {
          if (options.dryRun) {
            results.push({ ...base, status: "planned" });
            continue;
          }
          if (op.reset) resetRegistration(options.run, op.reset);
          options.run(op.run[0], op.run.slice(1));
          results.push({ ...base, status: "created" });
        }
      } catch (err) {
        results.push({ ...base, status: "failed", detail: (err as Error).message });
      }
    }

    const failed = results.slice(first).some((r) => r.status === "failed");
    if (!options.dryRun && !failed) {
      record.installs[key] = {
        agent: plan.agent,
        installedAt: prior?.installedAt ?? new Date().toISOString(),
        version: VERSION,
        scope: options.scope,
        project: options.scope === "project" ? options.project : undefined,
        packs: options.packs,
        bin: options.bin,
        gate: options.gate,
        files,
      };
      changed = true;
    }
  }
  if (changed) writeRecord(options.home, record);
  return { results, notes };
}

export interface UninstallOptions {
  agents: AgentName[];
  scope: Scope;
  home: string;
  project: string;
  dryRun: boolean;
  run: Runner;
}

function restoreOrRemove(path: string, file: InstalledFile | undefined): string {
  const backup = file?.backup;
  if (file && !file.created && backup && existsSync(backup)) {
    rmSync(path, { recursive: true, force: true });
    cpSync(backup, path, { recursive: true, verbatimSymlinks: true });
    return "restored from backup";
  }
  rmSync(path, { recursive: true, force: true });
  return "removed";
}

export function uninstall(options: UninstallOptions): InstallOutcome {
  const record = readRecord(options.home);
  const results: OpResult[] = [];
  const removing = new Set(options.agents.map((a) => recordKey(a, options.scope, options.project)));
  const stillNeeded = new Set<string>();
  for (const [key, entry] of Object.entries(record.installs)) {
    if (removing.has(key)) continue;
    for (const op of planAgent(contextForRecord(entry, options.home, options.project)).ops) {
      if (op.kind === "skill") stillNeeded.add(op.path);
    }
  }

  let changed = false;
  for (const agent of options.agents) {
    const key = recordKey(agent, options.scope, options.project);
    const entry = record.installs[key];
    if (!entry) {
      results.push({
        agent,
        label: "install record",
        target: agent,
        status: "unchanged",
        detail: `not installed at ${options.scope} scope`,
      });
      continue;
    }
    const plan = planAgent(contextForRecord(entry, options.home, options.project));
    const first = results.length;
    for (const op of [...plan.ops].reverse()) {
      const base = { agent, label: op.label, target: target(op) };
      const file = op.kind === "command" ? undefined : entry.files.find((f) => f.path === op.path);
      try {
        if (op.kind === "merge") {
          if (!existsSync(op.path)) continue;
          const existing = readFileSync(op.path, "utf8");
          const next = op.remove(existing);
          if (next === existing) {
            results.push({ ...base, status: "unchanged" });
            continue;
          }
          let detail: string | undefined;
          if (!options.dryRun) {
            if (next.trim() === "") detail = restoreOrRemove(op.path, file);
            else writeFileSync(op.path, next);
          }
          results.push({ ...base, status: options.dryRun ? "planned" : "updated", detail });
        } else if (op.kind === "file") {
          if (!existsSync(op.path)) continue;
          const detail = options.dryRun ? undefined : restoreOrRemove(op.path, file);
          results.push({ ...base, status: options.dryRun ? "planned" : "updated", detail });
        } else if (op.kind === "skill") {
          if (!existsSync(op.path)) continue;
          if (stillNeeded.has(op.path)) {
            results.push({ ...base, status: "unchanged", detail: "still used by another agent" });
            continue;
          }
          const detail = options.dryRun ? undefined : restoreOrRemove(op.path, file);
          results.push({ ...base, status: options.dryRun ? "planned" : "updated", detail });
        } else if (!options.dryRun) {
          options.run(op.undo[0], op.undo.slice(1));
          results.push({ ...base, status: "updated", detail: "removed" });
        } else {
          results.push({ ...base, status: "planned" });
        }
      } catch (err) {
        results.push({ ...base, status: "failed", detail: (err as Error).message });
      }
    }
    const failed = results.slice(first).some((r) => r.status === "failed");
    if (!options.dryRun && !failed) {
      delete record.installs[key];
      changed = true;
    }
  }
  if (changed) writeRecord(options.home, record);
  return { results, notes: [] };
}
