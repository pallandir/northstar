import { exec } from "./exec.js";
import type { AgentKind } from "./payload.js";

const MAX_DEPTH = 8;

interface ProcInfo {
  ppid: number;
  tty: string | null;
}

async function procInfo(pid: number): Promise<ProcInfo> {
  const out = await exec("ps", ["-o", "ppid=,tty=", "-p", String(pid)]);
  const match = out.trim().match(/^(\d+)\s+(\S+)$/);
  if (!match) throw new Error(`ps returned nothing for process ${pid}`);
  const tty = match[2];
  return { ppid: Number(match[1]), tty: tty === "??" || tty === "?" ? null : tty };
}

export async function findControllingTty(startPid: number = process.pid): Promise<string | null> {
  let pid = startPid;
  for (let depth = 0; depth < MAX_DEPTH && pid > 1; depth += 1) {
    const info = await procInfo(pid);
    if (info.tty) return info.tty.startsWith("/dev/") ? info.tty : `/dev/${info.tty}`;
    pid = info.ppid;
  }
  return null;
}

const CLAUDE_PROCESS = /(^|[\\/\s])claude(\s|$)|@anthropic-ai[\\/]claude-code/;

export async function findAgentKind(startPid: number = process.pid): Promise<AgentKind> {
  let pid = startPid;
  for (let depth = 0; depth < MAX_DEPTH && pid > 1; depth += 1) {
    const out = await exec("ps", ["-o", "ppid=,command=", "-p", String(pid)]);
    const match = out.trim().match(/^(\d+)\s+(.*)$/s);
    if (!match) throw new Error(`ps returned nothing for process ${pid}`);
    if (depth > 0 && CLAUDE_PROCESS.test(match[2] as string)) return "claude-code";
    pid = Number(match[1]);
  }
  return "other";
}
