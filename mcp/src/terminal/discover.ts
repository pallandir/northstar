import { exec } from "./exec.js";

const MAX_DEPTH = 8;

interface ProcInfo {
  ppid: number;
  tty: string | null;
}

async function procInfo(pid: number): Promise<ProcInfo | null> {
  try {
    const out = await exec("ps", ["-o", "ppid=,tty=", "-p", String(pid)]);
    const match = out.trim().match(/^(\d+)\s+(\S+)$/);
    if (!match) return null;
    const tty = match[2];
    return { ppid: Number(match[1]), tty: tty === "??" || tty === "?" ? null : tty };
  } catch {
    return null;
  }
}

// The MCP server is spawned detached from the terminal, so its own controlling tty reads "??".
// The agent that launched it still owns one, so walk up until a real device appears.
export async function findControllingTty(startPid: number = process.pid): Promise<string | null> {
  let pid = startPid;
  for (let depth = 0; depth < MAX_DEPTH && pid > 1; depth += 1) {
    const info = await procInfo(pid);
    if (!info) return null;
    if (info.tty) return info.tty.startsWith("/dev/") ? info.tty : `/dev/${info.tty}`;
    pid = info.ppid;
  }
  return null;
}
