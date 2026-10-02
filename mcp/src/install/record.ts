import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { AGENT_NAMES, type AgentName, type Scope } from "./plans/index.js";

const installedFileSchema = z.object({
  path: z.string(),
  backup: z.string().optional(),
  created: z.boolean(),
});

const agentRecordSchema = z.object({
  agent: z.enum(AGENT_NAMES),
  installedAt: z.string(),
  version: z.string(),
  scope: z.enum(["user", "project"]),
  project: z.string().optional(),
  bin: z.string().optional(),
  gate: z.boolean().optional(),
  files: z.array(installedFileSchema),
});

const recordSchema = z.object({
  installs: z.record(z.string(), agentRecordSchema).default({}),
});

export type InstalledFile = z.infer<typeof installedFileSchema>;
export type AgentRecord = z.infer<typeof agentRecordSchema>;
type InstallRecord = z.infer<typeof recordSchema>;

export function recordKey(agent: AgentName, scope: Scope, project: string): string {
  return scope === "project" ? `${agent}:project:${project}` : `${agent}:user`;
}

function recordPath(home: string): string {
  return join(home, ".northstar", "install.json");
}

export function readRecord(home: string): InstallRecord {
  const path = recordPath(home);
  if (!existsSync(path)) return { installs: {} };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON (${(err as Error).message}), fix it or delete it and run northstar install again`,
    );
  }
  const parsed = recordSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${path} is corrupt (${issue?.path.join(".")}: ${issue?.message}), delete it and run northstar install again`,
    );
  }
  return parsed.data;
}

export function writeRecord(home: string, record: InstallRecord): void {
  const path = recordPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temp, path);
}
