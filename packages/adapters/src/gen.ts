import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { loadCanon } from "@northstar/canon";
import { AGENT_NAMES, type Op, type PlanContext, planAgent } from "./agents/index.js";
import { hooksManifest, marketplaceManifest, mcpManifest, pluginManifest } from "./claude.js";
import { renderRuleIndex, renderSkill } from "./render.js";

export const SKILL_DIR = "plugin/skills/northstar";
export const INTEGRATIONS_DIR = "integrations";
export const GENERATED_DIRS = [
  SKILL_DIR,
  INTEGRATIONS_DIR,
  "plugin/agents",
  "plugin/hooks",
  "plugin/.claude-plugin",
  ".claude-plugin",
];

export type Outputs = Map<string, string>;

function posix(path: string): string {
  return path.split(sep).join("/");
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

export function generate(repoRoot: string): Outputs {
  const canonRoot = join(repoRoot, "canon");
  const canon = loadCanon(canonRoot);
  const version = (
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }
  ).version;
  const outputs: Outputs = new Map();

  const template = readFileSync(join(canonRoot, "skill", "SKILL.md.tmpl"), "utf8");
  outputs.set(`${SKILL_DIR}/SKILL.md`, renderSkill(canon, template, version));
  for (const reference of canon.references) {
    outputs.set(`${SKILL_DIR}/references/${reference.topic}.md`, reference.body);
  }
  for (const file of listFiles(join(canonRoot, "templates"))) {
    outputs.set(
      `${SKILL_DIR}/assets/${posix(relative(join(canonRoot, "templates"), file))}`,
      readFileSync(file, "utf8"),
    );
  }

  outputs.set("plugin/.claude-plugin/plugin.json", pluginManifest(version));
  outputs.set("plugin/hooks/hooks.json", hooksManifest(version));
  outputs.set("plugin/.mcp.json", mcpManifest(version));
  outputs.set(
    "plugin/agents/northstar-critic.md",
    readFileSync(join(canonRoot, "agents", "critic.md"), "utf8"),
  );
  outputs.set(".claude-plugin/marketplace.json", marketplaceManifest(version));
  outputs.set("docs/canon.md", renderRuleIndex(canon));
  for (const [path, content] of renderIntegrations(canonRoot, version)) outputs.set(path, content);
  return outputs;
}

const HOME = "~";
const PROJECT = ".";

function referenceName(path: string, op: Op): string {
  if (op.kind === "merge" && /(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$/.test(path)) return "context.md";
  return path.split("/").pop()?.replace(/^\./, "") ?? path;
}

function renderIntegrations(canonRoot: string, version: string): Outputs {
  const outputs: Outputs = new Map();
  const snippet = readFileSync(join(canonRoot, "snippets", "agents-md.md"), "utf8");
  const critic = readFileSync(join(canonRoot, "agents", "critic.md"), "utf8");
  const rows: string[] = [];
  for (const agent of AGENT_NAMES) {
    const context = (scope: PlanContext["scope"]): PlanContext => ({
      agent,
      scope,
      home: HOME,
      project: PROJECT,
      version,
      packs: "all",
      snippet,
      critic,
    });
    const project = planAgent(context("project"));
    const user = planAgent(context("user"));
    const userPaths = new Map<string, string>();
    for (const op of user.ops) {
      if (op.kind === "merge" || op.kind === "file")
        userPaths.set(referenceName(op.path, op), op.path);
    }
    for (const op of project.ops) {
      if (op.kind === "skill" || op.kind === "command") continue;
      const name = referenceName(op.path, op);
      const content = op.kind === "merge" ? op.apply(undefined) : op.content;
      outputs.set(`${INTEGRATIONS_DIR}/${agent}/${name}`, content);
      const userPath = userPaths.get(name) ?? "not used at user scope";
      rows.push(`| ${agent} | \`${agent}/${name}\` | \`${op.path}\` | \`${userPath}\` |`);
    }
    const skill = project.ops.find((op) => op.kind === "skill");
    const userSkill = user.ops.find((op) => op.kind === "skill");
    if (skill?.kind === "skill" && userSkill?.kind === "skill") {
      rows.push(`| ${agent} | skill folder | \`${skill.path}\` | \`${userSkill.path}\` |`);
    }
  }
  outputs.set(
    `${INTEGRATIONS_DIR}/README.md`,
    [
      "# Integrations",
      "",
      "Generated from the same plans that `northstar install` uses. Use these when you prefer to configure an agent by hand. Merge the content into the destination rather than replacing a file that already exists.",
      "",
      "| Agent | File here | Project destination | User destination |",
      "|---|---|---|---|",
      ...rows,
      "",
      "Claude Code registers the server with its own cli at user scope: `claude mcp add --env NORTHSTAR_PACKS=all --transport stdio --scope user northstar -- npx -y @pallandir/northstar`.",
      "",
      "The skill folder is `plugin/skills/northstar` in this repository, copy it to the destination shown.",
      "",
    ].join("\n"),
  );
  return outputs;
}

export function drift(repoRoot: string, outputs: Outputs): string[] {
  const problems: string[] = [];
  for (const [path, content] of outputs) {
    const full = join(repoRoot, path);
    if (!existsSync(full)) problems.push(`missing ${path}`);
    else if (readFileSync(full, "utf8") !== content) problems.push(`stale ${path}`);
  }
  for (const dir of GENERATED_DIRS) {
    for (const file of listFiles(join(repoRoot, dir))) {
      const path = posix(relative(repoRoot, file));
      if (!outputs.has(path)) problems.push(`unexpected ${path}`);
    }
  }
  return problems;
}

export function write(repoRoot: string, outputs: Outputs): void {
  for (const dir of GENERATED_DIRS) rmSync(join(repoRoot, dir), { recursive: true, force: true });
  for (const [path, content] of outputs) {
    const full = join(repoRoot, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}
