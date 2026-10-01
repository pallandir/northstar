import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadCanon } from "@northstar/canon";
import { hooksManifest, marketplaceManifest, pluginManifest } from "./claude.js";
import { renderRuleIndex, renderSkill } from "./render.js";

export const SKILL_DIR = "plugin/skills/northstar";

export type Outputs = Map<string, string>;

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
      `${SKILL_DIR}/assets/${relative(join(canonRoot, "templates"), file)}`,
      readFileSync(file, "utf8"),
    );
  }

  outputs.set("plugin/.claude-plugin/plugin.json", pluginManifest(version));
  outputs.set("plugin/hooks/hooks.json", hooksManifest(version));
  outputs.set(
    "plugin/agents/northstar-critic.md",
    readFileSync(join(canonRoot, "agents", "critic.md"), "utf8"),
  );
  outputs.set(".claude-plugin/marketplace.json", marketplaceManifest(version));
  outputs.set("docs/canon.md", renderRuleIndex(canon));
  return outputs;
}

export function drift(repoRoot: string, outputs: Outputs): string[] {
  const problems: string[] = [];
  for (const [path, content] of outputs) {
    const full = join(repoRoot, path);
    if (!existsSync(full)) problems.push(`missing ${path}`);
    else if (readFileSync(full, "utf8") !== content) problems.push(`stale ${path}`);
  }
  for (const file of listFiles(join(repoRoot, SKILL_DIR))) {
    const path = relative(repoRoot, file);
    if (!outputs.has(path)) problems.push(`unexpected ${path}`);
  }
  return problems;
}

export function write(repoRoot: string, outputs: Outputs): void {
  rmSync(join(repoRoot, SKILL_DIR), { recursive: true, force: true });
  for (const [path, content] of outputs) {
    const full = join(repoRoot, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}
