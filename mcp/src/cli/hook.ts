import {
  HOOK_AGENTS,
  type HookAgent,
  type HookInput,
  feedbackText,
  findProjectRoot,
  preEditReason,
} from "../lib/hook-feedback.js";

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

export function renderDeny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

export function claudeFeedback(input: HookInput, root: string): string | undefined {
  const text = feedbackText("claude", input, root);
  return text ? render("claude", text) : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

interface Parsed {
  event: "post-edit" | "pre-edit";
  agent: HookAgent;
}

function parseArgs(args: string[]): Parsed {
  const [event, ...rest] = args;
  if (event !== "post-edit" && event !== "pre-edit") {
    throw new Error(`unknown hook event ${event ?? "(none)"}, use post-edit or pre-edit`);
  }
  const flag = rest.indexOf("--agent");
  const named = flag === -1 ? "claude" : (rest[flag + 1] ?? "");
  const agent = HOOK_AGENTS.find((candidate) => candidate === named);
  if (!agent) throw new Error(`unknown agent ${named || "(none)"}, use ${HOOK_AGENTS.join(", ")}`);
  return { event, agent };
}

function parseInput(raw: string): HookInput {
  if (!raw.trim()) throw new Error("the hook received no input on stdin");
  try {
    return JSON.parse(raw) as HookInput;
  } catch (err) {
    throw new Error(`the hook input is not valid JSON: ${(err as Error).message}`);
  }
}

export async function hook(args: string[]): Promise<number> {
  try {
    const { event, agent } = parseArgs(args);
    const input = parseInput(await readStdin());
    const root = findProjectRoot(input.cwd ?? process.cwd());
    if (!root) return 0;
    if (event === "pre-edit") {
      const reason = preEditReason(agent, input, root);
      if (reason) process.stdout.write(`${renderDeny(reason)}\n`);
      return 0;
    }
    const text = feedbackText(agent, input, root);
    const output = text ? render(agent, text) : "";
    if (output) process.stdout.write(`${output}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`northstar hook: ${(err as Error).message}\n`);
    return 1;
  }
}
