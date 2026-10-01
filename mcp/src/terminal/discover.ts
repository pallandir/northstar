import type { AgentKind } from "@northstar/protocol";
import { exec } from "./exec.js";

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

export interface AgentProcess {
  kind: AgentKind;
  command: string;
}

const AGENT_PATTERNS: ReadonlyArray<readonly [Exclude<AgentKind, "other">, RegExp]> = [
  ["claude-code", /(^|[\\/\s])claude(\s|$)|@anthropic-ai[\\/]claude-code/],
  ["codex", /(^|[\\/\s])codex(\s|$)|@openai[\\/]codex/],
  ["gemini", /(^|[\\/\s])gemini(\s|$)|@google[\\/]gemini-cli/],
];

export function classifyCommand(command: string): AgentKind {
  for (const [kind, pattern] of AGENT_PATTERNS) if (pattern.test(command)) return kind;
  return "other";
}

export async function findAgent(startPid: number = process.pid): Promise<AgentProcess> {
  let pid = startPid;
  for (let depth = 0; depth < MAX_DEPTH && pid > 1; depth += 1) {
    const out = await exec("ps", ["-o", "ppid=,command=", "-p", String(pid)]);
    const match = out.trim().match(/^(\d+)\s+(.*)$/s);
    if (!match) throw new Error(`ps returned nothing for process ${pid}`);
    const command = match[2] as string;
    if (depth > 0) {
      const kind = classifyCommand(command);
      if (kind !== "other") return { kind, command };
    }
    pid = Number(match[1]);
  }
  return { kind: "other", command: "" };
}
