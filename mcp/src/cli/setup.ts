import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { doctor } from "../install/doctor.js";
import { type InstallOutcome, type OpResult, install, uninstall } from "../install/install.js";
import { type HostResult, installHost, uninstallHost } from "../install/native-manifest.js";
import { AGENT_NAMES, type AgentName, type Packs, type Scope } from "../install/plans/index.js";
import { northstarPluginInstalled } from "../install/plugin.js";
import { readRecord } from "../install/record.js";
import { feedbackText } from "../lib/hook-feedback.js";
import { recordUserPath } from "../lib/user-path.js";

interface Options {
  agents: AgentName[];
  all: boolean;
  scope: Scope;
  packs: Packs;
  dryRun: boolean;
  yes: boolean;
  home: string;
  project: string;
  bin?: string;
  gate: boolean;
  host: boolean;
  extensionIds: string[];
}

function parse(args: string[]): Options {
  const options: Options = {
    agents: [],
    all: false,
    scope: "user",
    packs: "dynamic",
    dryRun: false,
    yes: false,
    home: homedir(),
    project: process.env.NORTHSTAR_ROOT ?? process.cwd(),
    gate: true,
    host: true,
    extensionIds: [],
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const value = () => {
      const next = args[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--all") options.all = true;
    else if (arg === "--no-gate") options.gate = false;
    else if (arg === "--no-host") options.host = false;
    else if (arg === "--allow-extension") options.extensionIds.push(value());
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes") options.yes = true;
    else if (arg === "--agent") {
      for (const name of value().split(",")) {
        if (!(AGENT_NAMES as readonly string[]).includes(name))
          throw new Error(`unknown agent ${name}`);
        options.agents.push(name as AgentName);
      }
    } else if (arg === "--scope") {
      const scope = value();
      if (scope !== "user" && scope !== "project") throw new Error(`unknown scope ${scope}`);
      options.scope = scope;
    } else if (arg === "--packs") {
      const packs = value();
      if (packs !== "all" && packs !== "dynamic") throw new Error(`unknown packs ${packs}`);
      options.packs = packs;
    } else if (arg === "--home") options.home = resolve(value());
    else if (arg === "--project") options.project = resolve(value());
    else if (arg === "--bin") options.bin = resolve(value());
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

const MARKERS: Array<[AgentName, string[]]> = [
  ["claude", [".claude"]],
  ["codex", [".codex"]],
  ["cursor", [".cursor"]],
  ["gemini", [".gemini"]],
  ["opencode", [".config/opencode"]],
];

function detect(home: string): AgentName[] {
  return MARKERS.filter(([, dirs]) => dirs.some((dir) => existsSync(join(home, dir)))).map(
    ([agent]) => agent,
  );
}

function installBrowserHost(options: Options, dryRun: boolean): HostResult[] {
  const script = process.argv[1];
  if (!script) throw new Error("Northstar cannot tell which script the browser helper should run.");
  const real = realpathSync(script);
  if (/[\\/]_npx[\\/]/.test(real)) {
    throw new Error(
      "The browser helper needs a permanent install, this run comes from the temporary npx cache. Run npm install -g @pallandir/northstar, then northstar install, or pass --no-host to skip the browser helper.",
    );
  }
  return installHost({
    home: options.home,
    node: process.execPath,
    script: real,
    extensionIds: options.extensionIds,
    dryRun,
  });
}

function printHost(results: HostResult[]): void {
  for (const r of results) {
    process.stdout.write(`${r.status.padEnd(9)} browser helper ${r.label}: ${r.target}\n`);
  }
}

const run = (command: string, args: string[]) => {
  execFileSync(command, args, { stdio: "pipe" });
};

function print(outcome: InstallOutcome): void {
  for (const r of outcome.results) {
    const detail = r.detail ? ` (${r.detail})` : "";
    process.stdout.write(`${r.status.padEnd(9)} ${r.agent} ${r.label}: ${r.target}${detail}\n`);
  }
  for (const note of [...new Set(outcome.notes)]) process.stdout.write(`note: ${note}\n`);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

function usage(message: string, name: string): number {
  process.stderr.write(
    `${message}\nUsage: northstar ${name} [--agent a,b | --all] [--scope user|project] [--packs all|dynamic] [--bin path] [--no-gate] [--no-host] [--allow-extension id] [--home dir] [--project dir] [--dry-run] [--yes]\n`,
  );
  return 2;
}

function failure(err: unknown): number {
  process.stderr.write(`${(err as Error).message}\n`);
  return 1;
}

function resolveAgents(options: Options): AgentName[] {
  if (options.all) return [...AGENT_NAMES];
  return options.agents.length ? [...new Set(options.agents)] : detect(options.home);
}

export async function installCommand(args: string[]): Promise<number> {
  let options: Options;
  try {
    options = parse(args);
  } catch (err) {
    return usage((err as Error).message, "install");
  }
  const agents = resolveAgents(options);
  if (!agents.length)
    return usage(
      "No agent found. Pass --agent claude,codex,cursor,gemini,opencode or --all.",
      "install",
    );

  let plugin: boolean;
  try {
    plugin = northstarPluginInstalled(options.home);
  } catch (err) {
    return failure(err);
  }
  const request = { ...options, agents, plugin };
  let preview: InstallOutcome;
  let hostPreview: HostResult[] = [];
  try {
    preview = install({ ...request, dryRun: true, run });
    if (options.host) hostPreview = installBrowserHost(options, true);
  } catch (err) {
    return failure(err);
  }
  process.stdout.write(
    `Plan for ${agents.join(", ")} (${options.scope} scope, ${options.packs} packs):\n`,
  );
  print(preview);
  printHost(hostPreview);
  const failed = preview.results.filter((r: OpResult) => r.status === "failed");
  if (failed.length) return 1;
  if (options.dryRun) return 0;
  if (
    !preview.results.some((r) => r.status === "planned") &&
    !hostPreview.some((r) => r.status === "planned")
  ) {
    process.stdout.write("Everything is already up to date.\n");
    return 0;
  }

  if (!options.yes) {
    if (!process.stdin.isTTY)
      return usage("Installing needs a terminal to confirm, or pass --yes.", "install");
    if (!(await confirm("Apply these changes?"))) return 0;
  }
  let outcome: InstallOutcome;
  let applied: HostResult[] = [];
  try {
    outcome = install({ ...request, dryRun: false, run });
    if (options.host) applied = installBrowserHost(options, false);
    recordUserPath(options.home);
  } catch (err) {
    return failure(err);
  }
  process.stdout.write("\n");
  print(outcome);
  printHost(applied);
  return outcome.results.some((r) => r.status === "failed") ? 1 : 0;
}

export async function uninstallCommand(args: string[]): Promise<number> {
  let options: Options;
  try {
    options = parse(args);
  } catch (err) {
    return usage((err as Error).message, "uninstall");
  }
  const agents = resolveAgents(options);
  if (!agents.length) return usage("No agent given. Pass --agent or --all.", "uninstall");
  if (!options.dryRun && !options.yes) {
    if (!process.stdin.isTTY)
      return usage("Uninstalling needs a terminal to confirm, or pass --yes.", "uninstall");
    if (!(await confirm(`Remove Northstar from ${agents.join(", ")}?`))) return 0;
  }
  let outcome: InstallOutcome;
  let removed: HostResult[] = [];
  try {
    const remaining = Object.values(readRecord(options.home).installs).filter(
      (entry) => !(agents.includes(entry.agent) && entry.scope === options.scope),
    );
    outcome = uninstall({
      agents,
      scope: options.scope,
      home: options.home,
      project: options.project,
      dryRun: options.dryRun,
      run,
    });
    if (options.host && remaining.length === 0) {
      removed = uninstallHost({ home: options.home, dryRun: options.dryRun });
    }
  } catch (err) {
    return failure(err);
  }
  print(outcome);
  printHost(removed);
  return outcome.results.some((r) => r.status === "failed") ? 1 : 0;
}

export async function doctorCommand(args: string[]): Promise<number> {
  let options: Options;
  try {
    options = parse(args);
  } catch (err) {
    return usage((err as Error).message, "doctor");
  }
  const checks = await doctor({
    home: options.home,
    project: options.project,
    run,
    scanHook: (input) => feedbackText("claude", input, input.cwd),
    host: options.host
      ? { node: process.execPath, script: realpathSync(process.argv[1] as string) }
      : undefined,
  });
  for (const check of checks)
    process.stdout.write(`${check.status.padEnd(4)} ${check.name}: ${check.detail}\n`);
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}
