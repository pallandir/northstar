import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Mode } from "@northstar/canon";
import {
  type Finding,
  type ScanConfig,
  configFromDesign,
  hookFeedback,
  kindOf,
  scanPaths,
} from "@northstar/detector";
import { getCanon } from "./assets.js";
import { resolveInside } from "./lib/paths.js";

export const HOOK_FINDING_CAP = 5;

function git(root: string, args: string[]): string[] {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    const detail = ((err as { stderr?: string }).stderr || (err as Error).message).trim();
    throw new Error(`git ${args[0]} failed in ${root}: ${detail}`);
  }
}

function changedFiles(root: string): string[] {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside[0] !== "true")
    throw new Error(`${root} is not inside a git work tree, pass paths instead of diff`);
  try {
    git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch {
    throw new Error(
      `${root} has no commits yet, pass paths instead of diff or make a first commit`,
    );
  }
  const tracked = git(root, ["diff", "--relative", "--name-only", "HEAD"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked, ...untracked])].filter((file) => kindOf(file));
}

function loadConfig(root: string, mode?: Mode): ScanConfig {
  const path = join(root, "DESIGN.md");
  const config = configFromDesign(existsSync(path) ? readFileSync(path, "utf8") : undefined);
  return mode ? { ...config, mode } : config;
}

export interface ScanRequest {
  root: string;
  paths?: string[];
  diff?: boolean;
  mode?: Mode;
}

export interface ScanOutcome {
  findings: Finding[];
  scanned: number;
  config: ScanConfig;
}

export function runScan(request: ScanRequest): ScanOutcome {
  const { root } = request;
  const config = loadConfig(root, request.mode);
  const requested = request.diff ? changedFiles(root) : (request.paths ?? []);
  const paths = requested.map((path) => resolveInside(root, path));
  if (request.diff && paths.length === 0) return { findings: [], scanned: 0, config };
  const { findings, scanned } = scanPaths(root, paths, config, getCanon());
  return { findings, scanned, config };
}

export function scanEdited(root: string, files: string[] | undefined): string {
  const paths: string[] = [];
  const skipped: string[] = [];
  for (const file of files ?? []) {
    try {
      const relative = resolveInside(root, file);
      if (kindOf(relative)) paths.push(relative);
    } catch (err) {
      skipped.push(`${file}: ${(err as Error).message}`);
    }
  }
  const notes = skipped.length ? `\nNorthstar did not scan:\n${skipped.join("\n")}` : "";
  if (!paths.length) return notes;
  try {
    const { findings } = runScan({ root, paths });
    const feedback = hookFeedback(findings, HOOK_FINDING_CAP);
    return `${
      feedback ? `\nNorthstar scan of the edited files found errors, fix them:\n${feedback}` : ""
    }${notes}`;
  } catch (err) {
    return `\nNorthstar scan failed: ${(err as Error).message}${notes}`;
  }
}
