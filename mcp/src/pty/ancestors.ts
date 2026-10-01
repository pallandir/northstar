import { runCommand } from "./run-command.js";

const MAX_DEPTH = 16;

export async function ancestorPids(start: number = process.pid): Promise<number[]> {
  const chain: number[] = [];
  let pid = start;
  for (let depth = 0; depth < MAX_DEPTH && pid > 1; depth += 1) {
    const out = (await runCommand("ps", ["-o", "ppid=", "-p", String(pid)])).trim();
    const parent = Number(out);
    if (!Number.isInteger(parent)) throw new Error(`ps returned nothing for process ${pid}`);
    if (parent > 1) chain.push(parent);
    pid = parent;
  }
  return chain;
}
