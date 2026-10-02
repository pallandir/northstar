import { homedir } from "node:os";
import { resolve } from "node:path";
import { type SessionInfo, TEMPLATE_IDS, templateSchema } from "@northstar/protocol";
import {
  BUILTIN_AGENTS,
  assertAgentId,
  describeAgents,
  findExecutable,
  mergeAgents,
} from "../agents/definitions.js";
import { connectDaemon } from "../daemon/client.js";
import { RpcError } from "../daemon/rpc.js";
import {
  SHELLS,
  type Shell,
  detectShell,
  installShell,
  shellInstalled,
  uninstallShell,
} from "../install/shell.js";
import { northstarHome } from "../lib/home.js";
import { userPath } from "../lib/user-path.js";
import { loadSettings, updateSettings } from "../user-config.js";

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}

function age(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export async function sessionsCommand(): Promise<number> {
  let sessions: SessionInfo[];
  try {
    const peer = await connectDaemon(() => {}, null, northstarHome());
    sessions = await peer.call<SessionInfo[]>("request", { action: "session.list", params: {} });
    peer.close();
  } catch (error) {
    if (!(error instanceof RpcError)) throw error;
    process.stdout.write("No sessions, the daemon is not running.\n");
    return 0;
  }
  if (sessions.length === 0) {
    process.stdout.write("No sessions. Start one with northstar run <agent>.\n");
    return 0;
  }
  const rows = sessions.map((s) => [
    s.id.slice(0, 8),
    s.agent,
    s.root,
    s.kind,
    age(s.lastActivityAt),
  ]);
  const header = ["ID", "AGENT", "PROJECT", "KIND", "ACTIVE"];
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] as string).length)),
  );
  for (const row of [header, ...rows]) {
    process.stdout.write(
      `${row
        .map((cell, i) => cell.padEnd(widths[i] as number))
        .join("  ")
        .trimEnd()}\n`,
    );
  }
  return 0;
}

export async function agentCommand(args: string[]): Promise<number> {
  const home = northstarHome();
  const [sub, ...rest] = args;
  if (sub === "list" || sub === undefined) {
    const settings = loadSettings(home);
    for (const agent of describeAgents(mergeAgents(settings.agents), userPath(home))) {
      process.stdout.write(
        `${agent.installed ? "installed" : "missing  "}  ${agent.id.padEnd(10)} ${agent.path ?? agent.name}\n`,
      );
    }
    return 0;
  }
  if (sub === "add") {
    const [id, path, ...flags] = rest;
    if (!id || !path)
      return fail(
        'Usage: northstar agent add <id> <path> [--name <name>] [--quick-run "-p {{prompt}}"]',
      );
    try {
      assertAgentId(id);
    } catch (error) {
      return fail((error as Error).message);
    }
    if (BUILTIN_AGENTS.some((a) => a.id === id)) {
      return fail(`${id} is a built in agent. Pick another id for your own definition.`);
    }
    const file = findExecutable(resolve(path));
    if (!file) return fail(`${path} is not an executable file.`);
    let name: string | undefined;
    let quick: string[] | undefined;
    for (let i = 0; i < flags.length; i += 2) {
      const flag = flags[i];
      const value = flags[i + 1];
      if (value === undefined) return fail(`${flag} needs a value.`);
      if (flag === "--name") name = value;
      else if (flag === "--quick-run") quick = value.split(/\s+/).filter(Boolean);
      else return fail(`Unknown option ${flag}.`);
    }
    try {
      updateSettings(home, {
        agent: {
          id,
          definition: { name, executable: file, quickRun: quick ? { args: quick } : undefined },
        },
      });
    } catch (error) {
      return fail((error as Error).message);
    }
    const shell = detectShell();
    if (shellInstalled(homedir(), shell)) {
      installShell({
        home: homedir(),
        shell,
        agents: mergeAgents(loadSettings(home).agents).map((a) => a.id),
      });
    }
    process.stdout.write(
      `Added ${id}. Open a new terminal and start it as usual, or run northstar run ${id}.\n`,
    );
    return 0;
  }
  return fail("Usage: northstar agent [list | add <id> <path>]");
}

export async function shellCommand(args: string[]): Promise<number> {
  const home = homedir();
  const [sub, ...flags] = args;
  if (sub !== "install" && sub !== "uninstall") {
    return fail("Usage: northstar shell install|uninstall [--shell zsh|bash|fish] [--dry-run]");
  }
  let shell: Shell | undefined;
  let dryRun = false;
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i] === "--dry-run") dryRun = true;
    else if (flags[i] === "--shell") {
      const value = flags[++i];
      if (!(SHELLS as readonly string[]).includes(value ?? ""))
        return fail(`Unknown shell ${value}.`);
      shell = value as Shell;
    } else return fail(`Unknown option ${flags[i]}.`);
  }
  try {
    const chosen = shell ?? detectShell();
    const agents = mergeAgents(loadSettings(northstarHome()).agents).map((a) => a.id);
    const results =
      sub === "install"
        ? installShell({ home, shell: chosen, agents, dryRun })
        : uninstallShell({ home, shell: chosen, dryRun });
    for (const r of results)
      process.stdout.write(`${r.status.padEnd(9)} ${r.label}: ${r.target}\n`);
    if (sub === "install" && !dryRun) {
      process.stdout.write(
        `Open a new ${chosen} session, then type ${agents.slice(0, 3).join(", ")} as usual.\n`,
      );
    }
    return 0;
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function configCommand(args: string[]): Promise<number> {
  const home = northstarHome();
  const [sub, key, value] = args;
  try {
    if (sub === undefined) {
      const s = loadSettings(home);
      process.stdout.write(
        `preferred agent: ${s.preferredAgent ?? "none"}\ntemplate: ${s.template}\n`,
      );
      for (const [pattern, directory] of Object.entries(s.projects)) {
        process.stdout.write(`project ${pattern} -> ${directory}\n`);
      }
      return 0;
    }
    if (sub === "set" && key === "preferred-agent" && value) {
      updateSettings(home, { preferredAgent: value === "none" ? null : value });
      return 0;
    }
    if (sub === "set" && key === "template" && value) {
      updateSettings(home, { template: templateSchema.parse(value) });
      return 0;
    }
    if (sub === "map" && key && value) {
      const projects = { ...loadSettings(home).projects, [key]: resolve(value) };
      updateSettings(home, { projects });
      return 0;
    }
    if (sub === "unmap" && key) {
      const projects = { ...loadSettings(home).projects };
      delete projects[key];
      updateSettings(home, { projects });
      return 0;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return fail(`The template must be one of ${TEMPLATE_IDS.join(", ")}.`);
    }
    return fail((error as Error).message);
  }
  return fail(
    "Usage: northstar config [set preferred-agent <id|none> | set template <id> | map <host[:port][/path]> <dir> | unmap <key>]",
  );
}
