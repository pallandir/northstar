import { runCommand } from "../pty/run-command.js";

export async function osascript(script: string): Promise<string> {
  return (await runCommand("osascript", ["-e", script])).trim();
}

export function appleQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
