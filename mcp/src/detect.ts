import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Mode } from "@northstar/canon";
import {
  type Finding,
  type ScanConfig,
  configFromDesign,
  kindOf,
  scanPaths,
} from "@northstar/detector";
import { getCanon } from "./assets.js";

export function resolveInside(root: string, path: string): string {
  const base = resolve(root);
  const full = isAbsolute(path) ? resolve(path) : resolve(base, path);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error(`path ${path} is outside the project root`);
  }
  return relative(base, full) || ".";
}

export function changedFiles(root: string): string[] {
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean);
  try {
    const tracked = git(["diff", "--name-only", "HEAD"]);
    const untracked = git(["ls-files", "--others", "--exclude-standard"]);
    return [...new Set([...tracked, ...untracked])].filter((file) => kindOf(file));
  } catch {
    return [];
  }
}

export function loadConfig(root: string, mode?: Mode): ScanConfig {
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
