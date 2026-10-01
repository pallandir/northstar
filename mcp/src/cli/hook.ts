import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { hookFeedback, kindOf } from "@northstar/detector";
import { runScan } from "../detect.js";
import { designGap as gapOf, readDesign } from "../project.js";

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

const UI_DEPENDENCY =
  /^(react|react-dom|next|preact|vue|nuxt|svelte|@sveltejs\/kit|@angular\/core|solid-js|astro|@remix-run\/react|lit|@builder\.io\/qwik)$/;
const NOT_UI_SOURCE = /(^|\/)(tests?|__tests__|__mocks__|fixtures|e2e)\/|\.(test|spec)\.[^/]+$/;

function hasUiDependency(dir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    return ["dependencies", "devDependencies", "peerDependencies"].some((key) =>
      Object.keys((pkg[key] as Record<string, unknown> | undefined) ?? {}).some((name) =>
        UI_DEPENDENCY.test(name),
      ),
    );
  } catch {
    return false;
  }
}

function hasUiAncestor(root: string, path: string): boolean {
  let dir = resolve(root, dirname(path));
  for (let depth = 0; depth < 8; depth++) {
    if (hasUiDependency(dir)) return true;
    if (dir === root || !dir.startsWith(root)) break;
    dir = dirname(dir);
  }
  return false;
}

export function optedIn(root: string, path: string): boolean {
  return existsSync(join(root, "DESIGN.md")) || hasUiAncestor(root, path);
}

const GATED_SOURCE = /\.(jsx|tsx|vue|svelte|astro|html|css|scss|sass|less|mdx)$/i;

export function designGap(root: string): string | undefined {
  return gapOf(readDesign(root));
}

export function gateReason(root: string, path: string): string | undefined {
  if (process.env.NORTHSTAR_GATE === "off") return undefined;
  if (!GATED_SOURCE.test(path) || NOT_UI_SOURCE.test(path) || !hasUiAncestor(root, path)) {
    return undefined;
  }
  const gap = designGap(root);
  if (!gap) return undefined;
  return `Northstar: write DESIGN.md before any UI code, ${gap}. Call design_md_normalize with the designer's direction file and write true, or design_system_propose, then design_md_validate until it is ready, then continue. Do not edit UI files first. Only set NORTHSTAR_GATE=off if the user asked to skip the design system.`;
}

function relativeTargets(agent: HookAgent, input: HookInput, root: string): string[] {
  return [...new Set(filesFor(agent, input))]
    .map((target) => relative(root, isAbsolute(target) ? target : join(root, target)))
    .filter((path) => !path.startsWith(".."));
}

export function preEditReason(
  agent: HookAgent,
  input: HookInput,
  fallbackRoot: string,
): string | undefined {
  if (agent !== "claude") return undefined;
  const allowed = EDIT_TOOLS[agent];
  if (allowed && input.tool_name && !allowed.has(input.tool_name)) return undefined;
  const root = resolve(input.cwd ?? fallbackRoot);
  for (const path of relativeTargets(agent, input, root)) {
    const reason = gateReason(root, path);
    if (reason) return reason;
  }
  return undefined;
}

export function feedbackText(
  agent: HookAgent,
  input: HookInput,
  fallbackRoot: string,
): string | undefined {
  const allowed = EDIT_TOOLS[agent];
  if (allowed && input.tool_name && !allowed.has(input.tool_name)) return undefined;

  const root = resolve(input.cwd ?? fallbackRoot);
  const paths = relativeTargets(agent, input, root).filter(
    (path) =>
      kindOf(path) &&
      !NOT_UI_SOURCE.test(path) &&
      existsSync(join(root, path)) &&
      optedIn(root, path),
  );
  if (!paths.length) return undefined;

  const reminder =
    agent === "claude"
      ? undefined
      : paths.map((path) => gateReason(root, path)).find((reason) => reason !== undefined);
  const { findings } = runScan({ root, paths });
  const feedback = hookFeedback(findings, 5);
  const scan = feedback
    ? `Northstar found UI errors in ${paths.join(", ")}. Fix them or add an allow entry with a reason.\n${feedback}`
    : undefined;
  return [reminder, scan].filter(Boolean).join("\n\n") || undefined;
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

export function renderDeny(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
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
    if (!agent || (event !== "post-edit" && event !== "pre-edit")) return 0;
    const input = JSON.parse((await readStdin()) || "{}") as HookInput;
    if (event === "pre-edit") {
      const reason = preEditReason(agent, input, process.cwd());
      if (reason) process.stdout.write(`${renderDeny(reason)}\n`);
      return 0;
    }
    const text = feedbackText(agent, input, process.cwd());
    const output = text ? render(agent, text) : "";
    if (output) process.stdout.write(`${output}\n`);
  } catch {
    return 0;
  }
  return 0;
}
