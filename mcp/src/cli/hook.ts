import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { hookFeedback, kindOf } from "@northstar/detector";
import { runScan } from "../detect.js";

export type HookAgent = "claude" | "codex" | "cursor" | "gemini" | "opencode";

const EDIT_TOOLS: Record<HookAgent, Set<string> | null> = {
  claude: new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]),
  codex: new Set(["apply_patch", "Edit", "Write"]),
  cursor: null,
  gemini: new Set(["write_file", "replace"]),
  opencode: null,
};

export interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
}

const PATCH_FILE = /^\*\*\* (?:Add|Update) File: (.+)$/gm;

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) strings(item, out);
  return out;
}

export function filesFor(agent: HookAgent, input: HookInput): string[] {
  const toolInput = input.tool_input ?? {};
  const direct = [toolInput.file_path, toolInput.filePath, toolInput.path].filter(
    (value): value is string => typeof value === "string",
  );
  if (agent !== "codex") return direct;
  const patched = strings(toolInput).flatMap((text) =>
    [...text.matchAll(PATCH_FILE)].map((match) => (match[1] ?? "").trim()),
  );
  return [...direct, ...patched];
}

export function feedbackText(
  agent: HookAgent,
  input: HookInput,
  fallbackRoot: string,
): string | undefined {
  const allowed = EDIT_TOOLS[agent];
  if (allowed && input.tool_name && !allowed.has(input.tool_name)) return undefined;

  const root = resolve(input.cwd ?? fallbackRoot);
  const paths = [...new Set(filesFor(agent, input))]
    .map((target) => relative(root, isAbsolute(target) ? target : join(root, target)))
    .filter((path) => !path.startsWith("..") && kindOf(path) && existsSync(join(root, path)));
  if (!paths.length) return undefined;

  const { findings } = runScan({ root, paths });
  const feedback = hookFeedback(findings, 5);
  if (!feedback) return undefined;
  return `Northstar found UI errors in ${paths.join(", ")}. Fix them or add an allow entry with a reason.\n${feedback}`;
}

export function render(agent: HookAgent, text: string): string {
  switch (agent) {
    case "claude":
      return JSON.stringify({ decision: "block", reason: text });
    case "codex":
      return JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text },
      });
    case "gemini":
      return JSON.stringify({
        hookSpecificOutput: { hookEventName: "AfterTool", additionalContext: text },
      });
    case "opencode":
      return text;
    case "cursor":
      return "";
  }
}

export function claudeFeedback(input: HookInput, fallbackRoot: string): string | undefined {
  const text = feedbackText("claude", input, fallbackRoot);
  return text ? render("claude", text) : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const AGENTS: HookAgent[] = ["claude", "codex", "cursor", "gemini", "opencode"];

export async function hook(args: string[]): Promise<number> {
  try {
    const [event, ...rest] = args;
    const named = rest[rest.indexOf("--agent") + 1] ?? "claude";
    const agent = AGENTS.find((a) => a === named);
    if (event !== "post-edit" || !agent) return 0;
    const input = JSON.parse((await readStdin()) || "{}") as HookInput;
    const text = feedbackText(agent, input, process.cwd());
    const output = text ? render(agent, text) : "";
    if (output) process.stdout.write(`${output}\n`);
  } catch {
    return 0;
  }
  return 0;
}
