import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { hookFeedback, kindOf } from "@northstar/detector";
import { runScan } from "../detect.js";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

interface ClaudeHookInput {
  tool_name?: string;
  tool_input?: { file_path?: string };
  cwd?: string;
}

export function claudeFeedback(input: ClaudeHookInput, fallbackRoot: string): string | undefined {
  if (input.tool_name && !EDIT_TOOLS.has(input.tool_name)) return undefined;
  const target = input.tool_input?.file_path;
  if (!target) return undefined;
  const root = resolve(input.cwd ?? fallbackRoot);
  const full = isAbsolute(target) ? target : join(root, target);
  const path = relative(root, full);
  if (path.startsWith("..") || !kindOf(path) || !existsSync(full)) return undefined;

  const { findings } = runScan({ root, paths: [path] });
  const feedback = hookFeedback(findings, 5);
  if (!feedback) return undefined;
  return JSON.stringify({
    decision: "block",
    reason: `Northstar found UI errors in ${path}. Fix them or add an allow entry with a reason.\n${feedback}`,
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function hook(args: string[]): Promise<number> {
  try {
    const [event, ...rest] = args;
    const agent = rest[rest.indexOf("--agent") + 1] ?? "claude";
    if (event !== "post-edit" || agent !== "claude") return 0;
    const input = JSON.parse((await readStdin()) || "{}") as ClaudeHookInput;
    const output = claudeFeedback(input, process.cwd());
    if (output) process.stdout.write(`${output}\n`);
  } catch {
    return 0;
  }
  return 0;
}
