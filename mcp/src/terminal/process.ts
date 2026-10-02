import { basename } from "node:path";
import { runCommand } from "../pty/run-command.js";

const MAX_DEPTH = 16;
const RUNTIMES = new Set(["node", "bun", "deno", "python", "python3"]);

export interface AgentProcess {
  pid: number;
  command: string;
  tty: string | null;
  executable: string;
}

interface ProcessRow {
  ppid: number;
  tty: string | null;
  command: string;
}

async function row(pid: number): Promise<ProcessRow> {
  const out = (await runCommand("ps", ["-o", "ppid=,tty=,command=", "-p", String(pid)])).trim();
  const match = /^(\d+)\s+(\S+)\s+(.*)$/s.exec(out);
  if (!match) throw new Error(`ps returned nothing for process ${pid}`);
  const tty = match[2] as string;
  return {
    ppid: Number(match[1]),
    tty: tty === "??" || tty === "?" ? null : tty.startsWith("/dev/") ? tty : `/dev/${tty}`,
    command: match[3] as string,
  };
}

export function executableOf(command: string): string {
  const [first = "", second = ""] = command.trim().split(/\s+/);
  const name = basename(first).replace(/^-/, "");
  return RUNTIMES.has(name) ? basename(second).replace(/\.m?js$/, "") : name;
}

export async function findAgentProcess(
  executables: readonly string[],
  start: number = process.pid,
): Promise<AgentProcess | null> {
  const wanted = new Set(executables.map((e) => basename(e)));
  let pid = start;
  for (let depth = 0; depth < MAX_DEPTH && pid > 1; depth += 1) {
    const info = await row(pid);
    const executable = executableOf(info.command);
    if (depth > 0 && wanted.has(executable)) {
      return { pid, command: info.command, tty: info.tty, executable };
    }
    pid = info.ppid;
  }
  return null;
}
