import { execFile } from "node:child_process";
import { promisify } from "node:util";

const EXEC_TIMEOUT_MS = 5_000;

const run = promisify(execFile);

export async function runCommand(file: string, args: string[]): Promise<string> {
  const { stdout } = await run(file, args, {
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    encoding: "utf8",
  });
  return stdout;
}
