import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { assertAgentId } from "../agents/definitions.js";
import { stateRoot } from "../lib/home.js";
import type { HostResult } from "./native-manifest.js";

export const SHELLS = ["zsh", "bash", "fish"] as const;
export type Shell = (typeof SHELLS)[number];

const BEGIN = "# >>> northstar >>>";
const END = "# <<< northstar <<<";

export function detectShell(shellEnv: string | undefined = process.env.SHELL): Shell {
  const name = basename(shellEnv ?? "");
  if ((SHELLS as readonly string[]).includes(name)) return name as Shell;
  throw new Error(
    `Northstar does not know the shell ${name || "(none)"}. Pass --shell zsh, bash or fish.`,
  );
}

function scriptPath(home: string, shell: Shell): string {
  return shell === "fish"
    ? join(home, ".config", "fish", "conf.d", "northstar.fish")
    : join(stateRoot(home), "shell", "northstar.sh");
}

function rcPath(home: string, shell: Shell): string | null {
  if (shell === "zsh") return join(home, ".zshrc");
  if (shell === "bash") return join(home, ".bashrc");
  return null;
}

function posixScript(agents: readonly string[]): string {
  const body = agents.map(
    (id) =>
      `${id}() {\n  if command -v northstar >/dev/null 2>&1; then\n    command northstar run ${id} "$@"\n  else\n    printf 'northstar is not on the PATH, running ${id} without Send to AI\\n' >&2\n    command ${id} "$@"\n  fi\n}\n`,
  );
  return `${BEGIN}\n${body.join("\n")}${END}\n`;
}

function fishScript(agents: readonly string[]): string {
  const body = agents.map(
    (id) =>
      `function ${id} --wraps ${id}\n  if command -sq northstar\n    command northstar run ${id} $argv\n  else\n    echo 'northstar is not on the PATH, running ${id} without Send to AI' >&2\n    command ${id} $argv\n  end\nend\n`,
  );
  return `${BEGIN}\n${body.join("\n")}${END}\n`;
}

function rcBlock(home: string, shell: Shell): string {
  return `${BEGIN}\n[ -f "${scriptPath(home, shell)}" ] && . "${scriptPath(home, shell)}"\n${END}\n`;
}

function withBlock(current: string, block: string): string {
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (start >= 0 && end > start) {
    return `${current.slice(0, start)}${block}${current.slice(end + END.length).replace(/^\n/, "")}`;
  }
  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  return `${current}${separator}${block}`;
}

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

function writeFile(path: string, content: string, dryRun: boolean, label: string): HostResult {
  const current = readIfPresent(path);
  const base = { label, target: path };
  if (current === content) return { ...base, status: "unchanged" };
  if (dryRun) return { ...base, status: "planned" };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return { ...base, status: current === undefined ? "created" : "updated" };
}

interface ShellOptions {
  home: string;
  shell: Shell;
  agents: readonly string[];
  dryRun?: boolean;
}

export function installShell(options: ShellOptions): HostResult[] {
  for (const id of options.agents) assertAgentId(id);
  const { home, shell } = options;
  const dryRun = options.dryRun ?? false;
  const script = shell === "fish" ? fishScript(options.agents) : posixScript(options.agents);
  const results = [writeFile(scriptPath(home, shell), script, dryRun, `${shell} functions`)];
  const rc = rcPath(home, shell);
  if (rc) {
    const current = readIfPresent(rc) ?? "";
    results.push(
      writeFile(rc, withBlock(current, rcBlock(home, shell)), dryRun, `${shell} rc file`),
    );
  }
  return results;
}

export function uninstallShell(options: Omit<ShellOptions, "agents">): HostResult[] {
  const { home, shell } = options;
  const results: HostResult[] = [];
  const script = scriptPath(home, shell);
  if (existsSync(script)) {
    if (!options.dryRun) rmSync(script);
    results.push({
      label: `${shell} functions`,
      target: script,
      status: options.dryRun ? "planned" : "removed",
    });
  } else {
    results.push({ label: `${shell} functions`, target: script, status: "missing" });
  }
  const rc = rcPath(home, shell);
  if (rc) {
    const current = readIfPresent(rc);
    if (current !== undefined && withoutBlock(current) !== current) {
      if (!options.dryRun) writeFileSync(rc, withoutBlock(current));
      results.push({
        label: `${shell} rc file`,
        target: rc,
        status: options.dryRun ? "planned" : "updated",
      });
    } else {
      results.push({ label: `${shell} rc file`, target: rc, status: "missing" });
    }
  }
  return results;
}

export function shellInstalled(home: string, shell: Shell): boolean {
  if (!existsSync(scriptPath(home, shell))) return false;
  const rc = rcPath(home, shell);
  return rc === null || (readIfPresent(rc) ?? "").includes(BEGIN);
}
