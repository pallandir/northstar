import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const AGENTS = ["claude", "codex", "cursor", "gemini", "opencode"] as const;
export type AgentName = (typeof AGENTS)[number];

export interface InstalledFile {
  path: string;
  backup?: string;
  created: boolean;
}

export interface AgentRecord {
  installedAt: string;
  version: string;
  scope: "user" | "project";
  packs: "all" | "dynamic";
  bin?: string;
  extensionIds?: string[];
  files: InstalledFile[];
}

export interface InstallRecord {
  agents: Partial<Record<AgentName, AgentRecord>>;
}

export function recordPath(home: string): string {
  return join(home, ".northstar", "install.json");
}

export function readRecord(home: string): InstallRecord {
  const path = recordPath(home);
  if (!existsSync(path)) return { agents: {} };
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as InstallRecord;
    return data && typeof data === "object" && data.agents ? data : { agents: {} };
  } catch {
    return { agents: {} };
  }
}

export function writeRecord(home: string, record: InstallRecord): void {
  const path = recordPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temp, path);
}
