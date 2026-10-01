import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { SKILL_DIR, drift, generate, write } from "../src/gen.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "northstar-gen-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function stage(): string {
  const root = mkdtempSync(join(scratch, "repo-"));
  cpSync(join(repoRoot, "canon"), join(root, "canon"), {
    recursive: true,
    filter: (source) => !source.includes("node_modules"),
  });
  cpSync(join(repoRoot, "package.json"), join(root, "package.json"));
  return root;
}

test("the router skill stays inside its token budget", () => {
  const skill = generate(repoRoot).get(`${SKILL_DIR}/SKILL.md`);
  assert.ok(skill);
  const [, frontmatter, body] = skill.split("---\n");
  assert.match(frontmatter ?? "", /^name: northstar$/m);
  const description = /^description: (.+)$/m.exec(frontmatter ?? "")?.[1] ?? "";
  assert.ok(description.length <= 600, `description is ${description.length} chars`);
  assert.ok((body ?? "").split("\n").length <= 150, "body exceeds 150 lines");
  assert.doesNotMatch(skill, /\{\{[A-Z_]+\}\}/);
});

test("the skill routes to every reference that exists", () => {
  const outputs = generate(repoRoot);
  const skill = outputs.get(`${SKILL_DIR}/SKILL.md`) ?? "";
  for (const path of outputs.keys()) {
    const match = /references\/(.+)$/.exec(path);
    if (match) assert.ok(skill.includes(`references/${match[1]}`), `${match[1]} is not routed`);
  }
});

test("a written tree has no drift, and an edit or a stray file is reported", () => {
  const root = stage();
  const outputs = generate(root);
  write(root, outputs);
  assert.deepEqual(drift(root, outputs), []);

  writeFileSync(join(root, `${SKILL_DIR}/SKILL.md`), "changed");
  writeFileSync(join(root, `${SKILL_DIR}/references/stray.md`), "x");
  const problems = drift(root, outputs);
  assert.ok(problems.some((p) => p.startsWith("stale ") && p.endsWith("SKILL.md")));
  assert.ok(problems.some((p) => p.startsWith("unexpected ") && p.endsWith("stray.md")));
});

test("the committed generated files are current", () => {
  assert.deepEqual(drift(repoRoot, generate(repoRoot)), []);
});

test("the plugin manifest carries the root package version", () => {
  const version = (
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }
  ).version;
  const manifest = JSON.parse(generate(repoRoot).get("plugin/.claude-plugin/plugin.json") ?? "{}");
  assert.equal(manifest.version, version);
  assert.equal(manifest.name, "northstar");
});

test("the plugin hook scans edits through the pinned launcher and never chains a fallback", () => {
  const hooks = JSON.parse(generate(repoRoot).get("plugin/hooks/hooks.json") ?? "{}");
  const entry = hooks.hooks.PostToolUse[0];
  assert.equal(entry.matcher, "Edit|Write|MultiEdit|NotebookEdit");
  const command: string = entry.hooks[0].command;
  assert.match(command, /^node -e "/);
  assert.match(
    command,
    /npx -y @pallandir\/northstar@\d+\.\d+\.\d+ hook post-edit --agent claude$/,
  );
  assert.doesNotMatch(command, /sh -c|\|\| true/);
});

test("the plugin ships an mcp config pinned to the same version as the hooks", () => {
  const outputs = generate(repoRoot);
  const mcp = JSON.parse(outputs.get("plugin/.mcp.json") ?? "{}");
  const version = JSON.parse(outputs.get("plugin/.claude-plugin/plugin.json") ?? "{}").version;
  assert.equal(mcp.mcpServers.northstar.command, "npx");
  assert.deepEqual(mcp.mcpServers.northstar.args, ["-y", `@pallandir/northstar@${version}`]);
});

test("drift reports stray files in every generated plugin directory", () => {
  const root = stage();
  const outputs = generate(root);
  write(root, outputs);
  for (const dir of ["plugin/agents", "plugin/hooks", "plugin/.claude-plugin", ".claude-plugin"]) {
    writeFileSync(join(root, dir, "stray.json"), "{}");
  }
  const problems = drift(root, outputs);
  for (const dir of ["plugin/agents", "plugin/hooks", "plugin/.claude-plugin", ".claude-plugin"]) {
    assert.ok(problems.includes(`unexpected ${dir}/stray.json`), dir);
  }
});

test("the critic agent ships read only", () => {
  const agent = generate(repoRoot).get("plugin/agents/northstar-critic.md") ?? "";
  assert.match(agent, /^---\nname: northstar-critic$/m);
  assert.match(agent, /^disallowedTools: Edit, Write, MultiEdit, NotebookEdit$/m);
  assert.doesNotMatch(agent, /[\u2013\u2014]/);
});

test("reference integrations exist for every agent and map to real destinations", () => {
  const outputs = generate(repoRoot);
  for (const path of [
    "integrations/claude/settings.json",
    "integrations/codex/config.toml",
    "integrations/cursor/northstar.mdc",
    "integrations/gemini/settings.json",
    "integrations/opencode/northstar.ts",
  ]) {
    assert.ok(outputs.has(path), path);
  }
  const readme = outputs.get("integrations/README.md") ?? "";
  assert.match(
    readme,
    /\| codex \| `codex\/config\.toml` \| `\.codex\/config\.toml` \| `~\/\.codex\/config\.toml` \|/,
  );
  assert.match(
    readme,
    /\| cursor \| `cursor\/northstar\.mdc` \|[^|]*\| `not used at user scope` \|/,
  );
  assert.doesNotMatch([...outputs.values()].join("\n"), /\/Users\//);
});

test("the plugin ships the design gate hook too", () => {
  const hooks = JSON.parse(generate(repoRoot).get("plugin/hooks/hooks.json") ?? "{}");
  assert.match(hooks.hooks.PreToolUse[0].hooks[0].command, /hook pre-edit --agent claude/);
});
