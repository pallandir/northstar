import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentName } from "@northstar/adapters";
import { planAgent } from "@northstar/adapters";
import { validateDesign } from "@northstar/design-md";
import { getCanon, getData } from "../assets.js";
import { feedbackText } from "../cli/hook.js";
import { VERSION } from "../config.js";
import { type Runner, findConflicts } from "./conflicts.js";
import { contextFor } from "./install.js";
import { readRecord } from "./record.js";

export interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface DoctorOptions {
  home: string;
  project: string;
  run: Runner;
  probePorts?: number[];
}

function skillVersion(dir: string): string | undefined {
  try {
    return /^\s+version: "?([^"\n]+)"?$/m.exec(readFileSync(join(dir, "SKILL.md"), "utf8"))?.[1];
  } catch {
    return undefined;
  }
}

async function listening(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(400),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function doctor(options: DoctorOptions): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string) =>
    checks.push({ name, status, detail });

  const major = Number(process.versions.node.split(".")[0]);
  add(
    "node",
    major >= 20 ? "ok" : "fail",
    `Node ${process.versions.node}${major >= 20 ? "" : ", Northstar needs 20 or newer"}`,
  );

  try {
    const canon = getCanon();
    const data = getData();
    add(
      "assets",
      "ok",
      `${canon.rules.length} rules, ${Object.values(data.rows).reduce((n, rows) => n + rows.length, 0)} data rows`,
    );
  } catch (err) {
    add("assets", "fail", (err as Error).message);
  }

  const record = readRecord(options.home);
  const agents = Object.keys(record.agents) as AgentName[];
  if (!agents.length) add("install", "warn", "No agent is set up yet, run northstar install");

  for (const agent of agents) {
    const entry = record.agents[agent];
    if (!entry) continue;
    if (entry.version !== VERSION)
      add(
        `${agent} version`,
        "warn",
        `installed ${entry.version}, package is ${VERSION}, run northstar install again`,
      );
    const plan = planAgent(
      contextFor(agent, {
        scope: entry.scope,
        packs: entry.packs ?? "all",
        home: options.home,
        project: options.project,
        bin: entry.bin,
        extensionIds: entry.extensionIds,
      }),
    );
    for (const op of plan.ops) {
      const name = `${agent} ${op.label}`;
      if (op.kind === "merge") {
        if (!existsSync(op.path))
          add(name, "fail", `${op.path} is missing, run northstar install --agent ${agent}`);
        else {
          let current = false;
          try {
            const text = readFileSync(op.path, "utf8");
            current = op.apply(text) === text;
          } catch {}
          add(
            name,
            current ? "ok" : "warn",
            current ? op.path : `${op.path} differs from what install writes`,
          );
        }
      } else if (op.kind === "file") {
        const ok = existsSync(op.path) && readFileSync(op.path, "utf8") === op.content;
        add(name, ok ? "ok" : "warn", ok ? op.path : `${op.path} is missing or out of date`);
      } else if (op.kind === "skill") {
        const found = skillVersion(op.path);
        if (!found) add(name, "fail", `no skill at ${op.path}`);
        else
          add(
            name,
            found === VERSION ? "ok" : "warn",
            found === VERSION ? op.path : `skill is ${found}, package is ${VERSION}`,
          );
      } else {
        try {
          options.run(op.run[0], ["mcp", "get", "northstar"]);
          add(name, "ok", "registered");
        } catch {
          add(name, "warn", "could not confirm the registration, run claude mcp list");
        }
      }
    }
    for (const note of plan.notes) add(`${agent} note`, "ok", note);
  }

  try {
    feedbackText(
      "claude",
      { tool_name: "Edit", tool_input: { file_path: "nothing.tsx" }, cwd: options.project },
      options.project,
    );
    add("hook", "ok", "the scan hook runs and never fails an edit");
  } catch (err) {
    add("hook", "fail", (err as Error).message);
  }

  const ports = options.probePorts ?? [7474, 7475, 7476];
  const up = (await Promise.all(ports.map(async (p) => ((await listening(p)) ? p : 0)))).filter(
    Boolean,
  );
  add(
    "ingest",
    "ok",
    up.length
      ? `listening on ${up.join(", ")}`
      : "not running, normal when no agent session is open",
  );

  const designPath = join(options.project, "DESIGN.md");
  if (existsSync(designPath)) {
    const canon = getCanon();
    const result = validateDesign(readFileSync(designPath, "utf8"), {
      rules: canon.rules.map((r) => ({ id: r.id, allowable: r.allowable })),
    });
    const errors = result.issues.filter((i) => i.severity === "error").length;
    add(
      "DESIGN.md",
      errors ? "warn" : "ok",
      errors
        ? `${errors} errors, call design_md_validate`
        : result.ready
          ? "valid"
          : `valid with ${result.placeholders} placeholders`,
    );
  }

  const conflicts = findConflicts(options.home);
  add(
    "conflicts",
    conflicts.length ? "warn" : "ok",
    conflicts.length ? `${conflicts.length} overlapping skills, run northstar conflicts` : "none",
  );
  return checks;
}
