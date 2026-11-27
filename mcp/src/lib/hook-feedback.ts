import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HOOK_FINDING_CAP, runScan } from "../detect.js";
import { hookFeedback, kindOf } from "../detector/index.js";
import { AGENT_NAMES, type AgentName } from "../install/plans/index.js";
import { readJsonFile } from "../project.js";
import { findProjectRoot as findRootFrom, isInside, relativeTarget } from "./paths.js";

export type HookAgent = AgentName;

export const HOOK_AGENTS: readonly HookAgent[] = AGENT_NAMES;

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
const FILE_KEYS = ["file_path", "filePath", "path", "notebook_path"];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) strings(item, out);
  return out;
}

export function filesFor(agent: HookAgent, input: HookInput): string[] {
  const toolInput = input.tool_input ?? {};
  const direct = FILE_KEYS.map((key) => toolInput[key]).filter(
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
  const pkg = readJsonFile(join(dir, "package.json"));
  if (!pkg) return false;
  return ["dependencies", "devDependencies", "peerDependencies"].some((key) =>
    Object.keys((pkg[key] as Record<string, unknown> | undefined) ?? {}).some((name) =>
      UI_DEPENDENCY.test(name),
    ),
  );
}

function hasUiAncestor(root: string, path: string): boolean {
  const base = resolve(root);
  let dir = resolve(base, dirname(path));
  while (isInside(base, dir)) {
    if (hasUiDependency(dir)) return true;
    if (dir === base) return false;
    dir = dirname(dir);
  }
  return false;
}

export function optedIn(root: string, path: string): boolean {
  return existsSync(join(root, "DESIGN.md")) || hasUiAncestor(root, path);
}

export function hookProjectRoot(
  start: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env.CLAUDE_PROJECT_DIR;
  return fromEnv ? resolve(fromEnv) : findRootFrom(start);
}

function relativeTargets(agent: HookAgent, input: HookInput, root: string): string[] {
  const out = new Set<string>();
  for (const target of filesFor(agent, input)) {
    const rel = relativeTarget(root, target);
    if (rel !== undefined) out.add(rel);
  }
  return [...out];
}

function allowedTool(agent: HookAgent, input: HookInput): boolean {
  const allowed = EDIT_TOOLS[agent];
  return !(allowed && input.tool_name && !allowed.has(input.tool_name));
}

export function feedbackText(agent: HookAgent, input: HookInput, root: string): string | undefined {
  if (!allowedTool(agent, input)) return undefined;
  const paths = relativeTargets(agent, input, root).filter(
    (path) =>
      kindOf(path) &&
      !NOT_UI_SOURCE.test(path) &&
      existsSync(join(root, path)) &&
      optedIn(root, path),
  );
  if (!paths.length) return undefined;

  const { findings } = runScan({ root, paths });
  const feedback = hookFeedback(findings, HOOK_FINDING_CAP);
  const scan = feedback
    ? `Northstar found UI errors in ${paths.join(", ")}. Fix them or add an allow entry with a reason.\n${feedback}`
    : undefined;
  return scan;
}
