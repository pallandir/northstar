import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type AgentName,
  type AgentPlan,
  ConfigError,
  type Op,
  type Packs,
  type PlanContext,
  type Scope,
  planAgent,
} from "@northstar/adapters";
import { canonRoot, skillRoot } from "../assets.js";
import { VERSION } from "../config.js";
import type { Runner } from "./conflicts.js";
import { type InstalledFile, readRecord, writeRecord } from "./record.js";

export interface InstallOptions {
  agents: AgentName[];
  scope: Scope;
  packs: Packs;
  home: string;
  project: string;
  dryRun: boolean;
  run: Runner;
  stamp?: string;
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
  options: Pick<InstallOptions, "scope" | "packs" | "home" | "project">,
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
  };
}

export function plansFor(
  options: Pick<InstallOptions, "agents" | "scope" | "packs" | "home" | "project">,
): AgentPlan[] {
  return options.agents.map((agent) => planAgent(contextFor(agent, options)));
}

function target(op: Op): string {
  return op.kind === "command" ? op.run.join(" ") : op.path;
}

function backupOf(path: string, stamp: string): string {
  const backup = `${path}.northstar-bak-${stamp}`;
  cpSync(path, backup);
  return backup;
}

function sameTree(a: string, b: string): boolean {
  try {
    return readFileSync(join(a, "SKILL.md"), "utf8") === readFileSync(join(b, "SKILL.md"), "utf8");
  } catch {
    return false;
  }
}

export function install(options: InstallOptions): InstallOutcome {
  const stamp = options.stamp ?? new Date().toISOString().replace(/[:.]/g, "-");
  const plans = plansFor(options);
  const results: OpResult[] = [];
  const notes = plans.flatMap((plan) => plan.notes);
  const record = readRecord(options.home);
  const doneSkills = new Set<string>();

  for (const plan of plans) {
    const files: InstalledFile[] = [];
    for (const op of plan.ops) {
      const base = { agent: plan.agent, label: op.label, target: target(op) };
      const fail = (detail: string) => results.push({ ...base, status: "failed", detail });
      try {
        if (op.kind === "merge") {
          const existed = existsSync(op.path);
          const existing = existed ? readFileSync(op.path, "utf8") : undefined;
          const next = op.apply(existing);
          if (next === existing) {
            results.push({ ...base, status: "unchanged" });
            files.push({ path: op.path, created: false });
            continue;
          }
          if (options.dryRun) {
            results.push({ ...base, status: "planned" });
            continue;
          }
          const backup = existed ? backupOf(op.path, stamp) : undefined;
          mkdirSync(dirname(op.path), { recursive: true });
          writeFileSync(op.path, next);
          results.push({ ...base, status: existed ? "updated" : "created", detail: backup });
          files.push({ path: op.path, created: !existed, backup });
        } else if (op.kind === "file") {
          const existed = existsSync(op.path);
          const existing = existed ? readFileSync(op.path, "utf8") : undefined;
          if (existing === op.content) {
            results.push({ ...base, status: "unchanged" });
            files.push({ path: op.path, created: false });
            continue;
          }
          if (options.dryRun) {
            results.push({ ...base, status: "planned" });
            continue;
          }
          const backup = existed ? backupOf(op.path, stamp) : undefined;
          mkdirSync(dirname(op.path), { recursive: true });
          writeFileSync(op.path, op.content);
          results.push({ ...base, status: existed ? "updated" : "created", detail: backup });
          files.push({ path: op.path, created: !existed, backup });
        } else if (op.kind === "skill") {
          if (doneSkills.has(op.path)) {
            results.push({ ...base, status: "unchanged", detail: "shared with another agent" });
            continue;
          }
          doneSkills.add(op.path);
          const source = skillRoot();
          if (sameTree(source, op.path)) {
            results.push({ ...base, status: "unchanged" });
            files.push({ path: op.path, created: false });
            continue;
          }
          if (options.dryRun) {
            results.push({ ...base, status: "planned" });
            continue;
          }
          const existed = existsSync(op.path);
          rmSync(op.path, { recursive: true, force: true });
          mkdirSync(dirname(op.path), { recursive: true });
          cpSync(source, op.path, { recursive: true });
          results.push({ ...base, status: existed ? "updated" : "created" });
          files.push({ path: op.path, created: !existed });
        } else {
          if (options.dryRun) {
            results.push({ ...base, status: "planned" });
            continue;
          }
          if (op.reset) {
            try {
              options.run(op.reset[0], op.reset.slice(1));
            } catch {}
          }
          options.run(op.run[0], op.run.slice(1));
          results.push({ ...base, status: "created" });
        }
      } catch (err) {
        fail(err instanceof ConfigError ? err.message : (err as Error).message);
      }
    }
    if (!options.dryRun) {
      record.agents[plan.agent] = {
        installedAt: new Date().toISOString(),
        version: VERSION,
        scope: options.scope,
        packs: options.packs,
        files,
      };
    }
  }
  if (!options.dryRun && results.some((r) => r.status !== "failed"))
    writeRecord(options.home, record);
  return { results, notes };
}

export interface UninstallOptions {
  agents: AgentName[];
  home: string;
  project: string;
  dryRun: boolean;
  run: Runner;
}

export function uninstall(options: UninstallOptions): InstallOutcome {
  const record = readRecord(options.home);
  const results: OpResult[] = [];
  const remaining = (Object.keys(record.agents) as AgentName[]).filter(
    (a) => !options.agents.includes(a),
  );
  const stillNeeded = new Set<string>();
  for (const agent of remaining) {
    const entry = record.agents[agent];
    if (!entry) continue;
    for (const op of planAgent(
      contextFor(agent, {
        scope: entry.scope,
        packs: entry.packs ?? "all",
        home: options.home,
        project: options.project,
      }),
    ).ops) {
      if (op.kind === "skill") stillNeeded.add(op.path);
    }
  }

  for (const agent of options.agents) {
    const entry = record.agents[agent];
    if (!entry) {
      results.push({
        agent,
        label: "install record",
        target: agent,
        status: "unchanged",
        detail: "not installed",
      });
      continue;
    }
    const plan = planAgent(
      contextFor(agent, {
        scope: entry.scope,
        packs: entry.packs ?? "all",
        home: options.home,
        project: options.project,
      }),
    );
    for (const op of [...plan.ops].reverse()) {
      const base = { agent, label: op.label, target: target(op) };
      try {
        if (op.kind === "merge") {
          if (!existsSync(op.path)) continue;
          const existing = readFileSync(op.path, "utf8");
          const next = op.remove(existing);
          if (next === existing) {
            results.push({ ...base, status: "unchanged" });
            continue;
          }
          if (!options.dryRun) {
            const created = entry.files.find((f) => f.path === op.path)?.created ?? false;
            if (!next.trim() && created) rmSync(op.path);
            else writeFileSync(op.path, next);
          }
          results.push({ ...base, status: options.dryRun ? "planned" : "updated" });
        } else if (op.kind === "file") {
          if (!existsSync(op.path)) continue;
          if (!options.dryRun) rmSync(op.path);
          results.push({
            ...base,
            status: options.dryRun ? "planned" : "updated",
            detail: "removed",
          });
        } else if (op.kind === "skill") {
          if (!existsSync(op.path)) continue;
          if (stillNeeded.has(op.path)) {
            results.push({ ...base, status: "unchanged", detail: "still used by another agent" });
            continue;
          }
          if (!options.dryRun) rmSync(op.path, { recursive: true, force: true });
          results.push({
            ...base,
            status: options.dryRun ? "planned" : "updated",
            detail: "removed",
          });
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
    if (!options.dryRun) delete record.agents[agent];
  }
  if (!options.dryRun) writeRecord(options.home, record);
  return { results, notes: [] };
}
