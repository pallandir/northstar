import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateRoot } from "../lib/home.js";
import type { HostResult } from "./native-manifest.js";

const BEGIN = "# >>> northstar >>>";
const END = "# <<< northstar <<<";

const RC_FILES = [".zshrc", ".bashrc"];

function withoutBlock(current: string): string {
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (start < 0 || end < start) return current;
  return `${current.slice(0, start)}${current.slice(end + END.length).replace(/^\n/, "")}`;
}

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function removeLegacyShell(home: string, dryRun: boolean): HostResult[] {
  const results: HostResult[] = [];
  const scripts = [
    join(stateRoot(home), "shell", "northstar.sh"),
    join(home, ".config", "fish", "conf.d", "northstar.fish"),
  ];
  for (const script of scripts) {
    if (!existsSync(script)) continue;
    if (!dryRun) rmSync(script);
    results.push({
      label: "shell functions",
      target: script,
      status: dryRun ? "planned" : "removed",
    });
  }
  for (const name of RC_FILES) {
    const rc = join(home, name);
    const current = readIfPresent(rc);
    if (current === undefined || withoutBlock(current) === current) continue;
    if (!dryRun) writeFileSync(rc, withoutBlock(current));
    results.push({ label: "shell rc file", target: rc, status: dryRun ? "planned" : "updated" });
  }
  return results;
}
