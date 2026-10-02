import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { northstarHome, stateDir } from "./home.js";

function recordedPath(home: string): string[] {
  const path = join(stateDir(home), "env.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as { path?: unknown };
  if (typeof parsed.path !== "string") {
    throw new Error(`${path} has no path entry. Delete it and run northstar install again.`);
  }
  return parsed.path.split(delimiter).filter(Boolean);
}

function unique(entries: string[]): string[] {
  return [...new Set(entries)];
}

export function recordUserPath(home: string = northstarHome()): void {
  const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const merged = unique([...current, ...recordedPath(home)]).join(delimiter);
  const dir = stateDir(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "env.json");
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify({ path: merged })}\n`, { mode: 0o600 });
  renameSync(staging, path);
}

export function userPath(home: string = northstarHome()): string {
  const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return unique([...current, ...recordedPath(home)]).join(delimiter);
}
