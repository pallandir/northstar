import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EXEC_TIMEOUT_MS } from "../config.js";

const run = promisify(execFile);

export async function exec(file: string, args: string[]): Promise<string> {
  const { stdout } = await run(file, args, {
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    encoding: "utf8",
  });
  return stdout;
}

export async function osascript(script: string): Promise<string> {
  return (await exec("osascript", ["-e", script])).trim();
}

export function appleQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
