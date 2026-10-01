import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { AGENT_NAMES, type AgentName } from "@northstar/adapters";
import { VERSION } from "../src/config.js";
import { doctor } from "../src/install/doctor.js";
import { install, uninstall } from "../src/install/install.js";
import { readRecord } from "../src/install/record.js";

const scratch = mkdtempSync(join(tmpdir(), "northstar-install-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function world() {
  const home = mkdtempSync(join(scratch, "home-"));
  const project = mkdtempSync(join(scratch, "project-"));
  const calls: string[][] = [];
  const run = (command: string, args: string[]) => {
    calls.push([command, ...args]);
  };
  return { home, project, calls, run };
}

const base = (w: ReturnType<typeof world>, agents: AgentName[] = [...AGENT_NAMES]) => ({
  agents,
  scope: "user" as const,
  packs: "all" as const,
  home: w.home,
  project: w.project,
  dryRun: false,
  run: w.run,
  stamp: "t0",
});

function put(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function tree(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tree(join(dir, e.name)) : [join(dir, e.name)],
  );
}

test("a dry run reports the plan and writes nothing", () => {
  const w = world();
  const outcome = install({ ...base(w), dryRun: true });
  assert.ok(outcome.results.length > 10);
  assert.ok(outcome.results.every((r) => r.status === "planned" || r.status === "unchanged"));
  assert.deepEqual(tree(w.home), []);
  assert.equal(w.calls.length, 0);
});

test("installing every agent writes each config, the skills and the record", () => {
  const w = world();
  const outcome = install(base(w));
  assert.deepEqual(
    outcome.results.filter((r) => r.status === "failed"),
    [],
  );

  assert.equal(
    JSON.parse(readFileSync(join(w.home, ".cursor/mcp.json"), "utf8")).mcpServers.northstar.command,
    "npx",
  );
  assert.match(
    readFileSync(join(w.home, ".codex/config.toml"), "utf8"),
    /\[mcp_servers\.northstar\]/,
  );
  assert.ok(JSON.parse(readFileSync(join(w.home, ".codex/hooks.json"), "utf8")).hooks.PostToolUse);
  const gemini = JSON.parse(readFileSync(join(w.home, ".gemini/settings.json"), "utf8"));
  assert.ok(gemini.mcpServers.northstar && gemini.hooks.AfterTool);
  assert.equal(
    JSON.parse(readFileSync(join(w.home, ".config/opencode/opencode.json"), "utf8")).mcp.northstar
      .type,
    "local",
  );
  assert.ok(existsSync(join(w.home, ".config/opencode/plugins/northstar.ts")));
  assert.ok(existsSync(join(w.home, ".claude/agents/northstar-critic.md")));
  for (const dir of [".claude/skills", ".agents/skills", ".config/opencode/skills"]) {
    assert.ok(existsSync(join(w.home, dir, "northstar/SKILL.md")), dir);
    assert.ok(existsSync(join(w.home, dir, "northstar/references/typography.md")), dir);
  }
  assert.ok(
    JSON.parse(readFileSync(join(w.home, ".claude/settings.json"), "utf8")).hooks.PostToolUse,
  );
  assert.ok(w.calls.some((c) => c.slice(0, 3).join(" ") === "claude mcp add"));

  const record = readRecord(w.home);
  assert.deepEqual(Object.keys(record.agents).sort(), [...AGENT_NAMES].sort());
  assert.equal(record.agents.codex?.packs, "all");
  assert.equal(record.agents.claude?.version, VERSION);
});

test("a second install changes nothing and makes no backups", () => {
  const w = world();
  install(base(w));
  const before = tree(w.home).sort();
  const again = install(base(w));
  assert.deepEqual(
    again.results
      .filter((r) => r.status === "created" || r.status === "updated" || r.status === "failed")
      .map((r) => `${r.agent} ${r.label} ${r.status}`),
    ["claude MCP server created"],
  );
  assert.deepEqual(tree(w.home).sort(), before);
});

test("an existing config keeps its other entries and is backed up first", () => {
  const w = world();
  const path = join(w.home, ".cursor/mcp.json");
  const original = JSON.stringify({ mcpServers: { other: { command: "keep" } }, extra: 1 });
  put(path, original);
  const outcome = install(base(w, ["cursor"]));
  const written = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(written.extra, 1);
  assert.deepEqual(written.mcpServers.other, { command: "keep" });
  assert.ok(written.mcpServers.northstar);
  const backup = outcome.results.find((r) => r.target === path)?.detail ?? "";
  assert.match(backup, /mcp\.json\.northstar-bak-t0$/);
  assert.equal(readFileSync(backup, "utf8"), original);
});

test("a config that cannot be parsed is reported, left untouched, and does not stop the rest", () => {
  const w = world();
  const path = join(w.home, ".gemini/settings.json");
  put(path, "{ // comments are not json\n");
  const outcome = install(base(w, ["gemini", "cursor"]));
  const failed = outcome.results.filter((r) => r.status === "failed");
  assert.equal(failed.length, 1);
  assert.match(failed[0]?.detail ?? "", /not valid JSON/);
  assert.equal(readFileSync(path, "utf8"), "{ // comments are not json\n");
  assert.ok(existsSync(join(w.home, ".cursor/mcp.json")));
});

test("a failing claude cli is reported but the file based parts still install", () => {
  const w = world();
  const outcome = install({
    ...base(w, ["claude"]),
    run: () => {
      throw new Error("claude: command not found");
    },
  });
  const failed = outcome.results.filter((r) => r.status === "failed");
  assert.equal(failed.length, 1);
  assert.match(failed[0]?.detail ?? "", /command not found/);
  assert.ok(existsSync(join(w.home, ".claude/skills/northstar/SKILL.md")));
});

test("project scope writes into the project and never into the home directory", () => {
  const w = world();
  install({ ...base(w, ["claude", "cursor", "codex"]), scope: "project" });
  assert.ok(existsSync(join(w.project, ".mcp.json")));
  assert.ok(existsSync(join(w.project, ".cursor/rules/northstar.mdc")));
  assert.ok(existsSync(join(w.project, ".agents/skills/northstar/SKILL.md")));
  assert.match(readFileSync(join(w.project, "AGENTS.md"), "utf8"), /northstar:begin/);
  assert.match(readFileSync(join(w.project, "CLAUDE.md"), "utf8"), /northstar:begin/);
  assert.deepEqual(
    tree(w.home).filter((p) => !p.includes(".northstar")),
    [],
  );
});

test("uninstalling one agent keeps the shared skill while another agent still needs it", () => {
  const w = world();
  install(base(w, ["cursor", "codex"]));
  const shared = join(w.home, ".agents/skills/northstar/SKILL.md");
  assert.ok(existsSync(shared));
  uninstall({ agents: ["cursor"], home: w.home, project: w.project, dryRun: false, run: w.run });
  assert.ok(existsSync(shared));
  assert.equal(existsSync(join(w.home, ".cursor/mcp.json")), false);
  assert.deepEqual(Object.keys(readRecord(w.home).agents), ["codex"]);
  uninstall({ agents: ["codex"], home: w.home, project: w.project, dryRun: false, run: w.run });
  assert.equal(existsSync(shared), false);
});

test("uninstall removes only what install added, restoring a pre-existing config", () => {
  const w = world();
  const path = join(w.home, ".cursor/mcp.json");
  put(path, JSON.stringify({ mcpServers: { other: { command: "keep" } } }));
  put(join(w.home, ".codex/AGENTS.md"), "# My rules\n\nBe kind.\n");
  install(base(w, ["cursor", "codex", "claude"]));
  uninstall({
    agents: ["cursor", "codex", "claude"],
    home: w.home,
    project: w.project,
    dryRun: false,
    run: w.run,
  });

  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
    mcpServers: { other: { command: "keep" } },
  });
  assert.equal(readFileSync(join(w.home, ".codex/AGENTS.md"), "utf8"), "# My rules\n\nBe kind.\n");
  assert.equal(existsSync(join(w.home, ".codex/config.toml")), false);
  assert.equal(existsSync(join(w.home, ".claude/skills/northstar")), false);
  assert.ok(w.calls.some((c) => c.join(" ") === "claude mcp remove northstar --scope user"));
  assert.deepEqual(readRecord(w.home).agents, {});
});

test("uninstall of an agent that was never installed is a quiet no-op", () => {
  const w = world();
  const outcome = uninstall({
    agents: ["gemini"],
    home: w.home,
    project: w.project,
    dryRun: false,
    run: w.run,
  });
  assert.equal(outcome.results[0]?.detail, "not installed");
});

test("doctor warns when nothing is installed, passes after an install and fails on a missing file", async () => {
  const w = world();
  const options = { home: w.home, project: w.project, run: w.run, probePorts: [] };
  assert.ok((await doctor(options)).some((c) => c.name === "install" && c.status === "warn"));

  install(base(w, ["cursor", "codex"]));
  const healthy = await doctor(options);
  assert.deepEqual(
    healthy.filter((c) => c.status === "fail"),
    [],
  );
  assert.ok(healthy.some((c) => c.name === "hook" && c.status === "ok"));

  rmSync(join(w.home, ".cursor/mcp.json"));
  const broken = await doctor(options);
  assert.ok(broken.some((c) => c.name === "cursor MCP server" && c.status === "fail"));
});

test("doctor flags an outdated skill and overlapping skills", async () => {
  const w = world();
  install(base(w, ["codex"]));
  const skill = join(w.home, ".agents/skills/northstar/SKILL.md");
  writeFileSync(
    skill,
    readFileSync(skill, "utf8").replace(`version: "${VERSION}"`, 'version: "0.0.1"'),
  );
  put(join(w.home, ".claude/skills/impeccable/SKILL.md"), "x");
  const checks = await doctor({ home: w.home, project: w.project, run: w.run, probePorts: [] });
  assert.ok(
    checks.some((c) => c.name === "codex skill" && c.status === "warn" && /0\.0\.1/.test(c.detail)),
  );
  assert.ok(checks.some((c) => c.name === "conflicts" && c.status === "warn"));
});

function cli(w: ReturnType<typeof world>, ...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", ...args, "--home", w.home, "--project", w.project],
    { encoding: "utf8", input: "" },
  );
}

test("the install command previews, needs confirmation without a terminal, and applies with --yes", () => {
  const w = world();
  const dry = cli(w, "install", "--agent", "cursor", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Plan for cursor/);
  assert.deepEqual(tree(w.home), []);

  const noTty = cli(w, "install", "--agent", "cursor");
  assert.equal(noTty.status, 2);
  assert.match(noTty.stderr, /needs a terminal/);

  const applied = cli(w, "install", "--agent", "cursor", "--yes");
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(existsSync(join(w.home, ".cursor/mcp.json")));

  const again = cli(w, "install", "--agent", "cursor", "--yes");
  assert.match(again.stdout, /already up to date/);

  const doctored = cli(w, "doctor");
  assert.equal(doctored.status, 0, doctored.stdout);
  const removed = cli(w, "uninstall", "--agent", "cursor", "--yes");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(join(w.home, ".cursor/mcp.json")), false);
});

test("the setup commands validate their options and detect agents from the home directory", () => {
  const w = world();
  assert.equal(cli(w, "install", "--agent", "vim").status, 2);
  assert.equal(cli(w, "install", "--scope", "galaxy").status, 2);
  assert.equal(cli(w, "install", "--packs", "some").status, 2);
  assert.match(cli(w, "install").stderr, /No agent found/);
  mkdirSync(join(w.home, ".gemini"));
  assert.match(cli(w, "install", "--dry-run").stdout, /Plan for gemini/);
});
