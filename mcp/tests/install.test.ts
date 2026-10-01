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
import { type DoctorOptions, doctor } from "../src/install/doctor.js";
import { install, uninstall } from "../src/install/install.js";
import { installHost } from "../src/install/native-manifest.js";
import { type AgentRecord, readRecord } from "../src/install/record.js";
import { feedbackText } from "../src/lib/hook-feedback.js";

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

const entryOf = (home: string, agent: AgentName): AgentRecord | undefined =>
  Object.values(readRecord(home).installs).find((entry) => entry.agent === agent);

const scanHook: DoctorOptions["scanHook"] = (input) => feedbackText("claude", input, input.cwd);

const doctorOptions = (w: ReturnType<typeof world>): DoctorOptions => ({
  home: w.home,
  project: w.project,
  run: w.run,
  scanHook,
  host: { node: process.execPath, script: join(w.home, "cli.js") },
  loadPty: async () => undefined,
});

const uninstallOf = (
  w: ReturnType<typeof world>,
  agents: AgentName[],
  scope: "user" | "project" = "user",
) => uninstall({ agents, scope, home: w.home, project: w.project, dryRun: false, run: w.run });

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
  assert.deepEqual(
    Object.values(record.installs)
      .map((e) => e.agent)
      .sort(),
    [...AGENT_NAMES].sort(),
  );
  assert.equal(entryOf(w.home, "codex")?.packs, "all");
  assert.equal(entryOf(w.home, "claude")?.version, VERSION);
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
  uninstallOf(w, ["cursor"]);
  assert.ok(existsSync(shared));
  assert.equal(existsSync(join(w.home, ".cursor/mcp.json")), false);
  assert.deepEqual(
    Object.values(readRecord(w.home).installs).map((e) => e.agent),
    ["codex"],
  );
  uninstallOf(w, ["codex"]);
  assert.equal(existsSync(shared), false);
});

test("uninstall removes only what install added, restoring a pre-existing config", () => {
  const w = world();
  const path = join(w.home, ".cursor/mcp.json");
  put(path, JSON.stringify({ mcpServers: { other: { command: "keep" } } }));
  put(join(w.home, ".codex/AGENTS.md"), "# My rules\n\nBe kind.\n");
  install(base(w, ["cursor", "codex", "claude"]));
  uninstallOf(w, ["cursor", "codex", "claude"]);

  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
    mcpServers: { other: { command: "keep" } },
  });
  assert.equal(readFileSync(join(w.home, ".codex/AGENTS.md"), "utf8"), "# My rules\n\nBe kind.\n");
  assert.equal(existsSync(join(w.home, ".codex/config.toml")), false);
  assert.equal(existsSync(join(w.home, ".claude/skills/northstar")), false);
  assert.ok(w.calls.some((c) => c.join(" ") === "claude mcp remove northstar --scope user"));
  assert.deepEqual(readRecord(w.home).installs, {});
});

test("uninstall of an agent that was never installed is a quiet no-op", () => {
  const w = world();
  const outcome = uninstallOf(w, ["gemini"]);
  assert.match(outcome.results[0]?.detail ?? "", /not installed/);
});

test("doctor warns when nothing is installed, passes after an install and fails on a missing file", async () => {
  const w = world();
  const options = doctorOptions(w);
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
  const checks = await doctor(doctorOptions(w));
  assert.ok(
    checks.some((c) => c.name === "codex skill" && c.status === "warn" && /0\.0\.1/.test(c.detail)),
  );
  assert.ok(checks.some((c) => c.name === "conflicts" && c.status === "warn"));
});

function cli(w: ReturnType<typeof world>, ...args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      ...args,
      "--home",
      w.home,
      "--project",
      w.project,
      "--no-host",
    ],
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

test("a local bin is used for the server and the hook, and doctor and uninstall follow it", async () => {
  const w = world();
  install({ ...base(w, ["cursor", "codex", "claude"]), bin: "/opt/northstar/dist/cli.js" });
  const cursor = JSON.parse(readFileSync(join(w.home, ".cursor/mcp.json"), "utf8")).mcpServers
    .northstar;
  assert.equal(cursor.command, "node");
  assert.deepEqual(cursor.args, ["/opt/northstar/dist/cli.js"]);
  assert.match(
    readFileSync(join(w.home, ".codex/config.toml"), "utf8"),
    /command = "node"\nargs = \["\/opt\/northstar\/dist\/cli\.js"\]/,
  );
  const hook = JSON.parse(readFileSync(join(w.home, ".codex/hooks.json"), "utf8")).hooks
    .PostToolUse[0].hooks[0].command as string;
  assert.ok(hook.startsWith('node -e "'));
  assert.ok(hook.endsWith(" /opt/northstar/dist/cli.js hook post-edit --agent codex"));
  assert.doesNotMatch(hook, /sh -c|\|\| true/);
  assert.ok(w.calls.some((c) => c.join(" ").endsWith("-- node /opt/northstar/dist/cli.js")));
  assert.equal(entryOf(w.home, "cursor")?.bin, "/opt/northstar/dist/cli.js");

  const checks = await doctor(doctorOptions(w));
  assert.deepEqual(
    checks.filter((c) => c.status === "fail"),
    [],
  );
  assert.ok(
    checks
      .filter((c) => /MCP server|hook/.test(c.name) && c.name !== "hook")
      .every((c) => c.status !== "warn"),
  );

  uninstallOf(w, ["cursor", "codex", "claude"]);
  assert.equal(existsSync(join(w.home, ".cursor/mcp.json")), false);
  assert.equal(existsSync(join(w.home, ".codex/hooks.json")), false);
});

test("the old extension id flag no longer exists", () => {
  const w = world();
  assert.equal(
    cli(w, "install", "--agent", "cursor", "--extension-id", "pemllnphnlcnkolginljldoejphkmbba")
      .status,
    2,
  );
  install(base(w, ["cursor"]));
  const env = JSON.parse(readFileSync(join(w.home, ".cursor/mcp.json"), "utf8")).mcpServers
    .northstar.env;
  assert.deepEqual(env, { NORTHSTAR_PACKS: "all" });
});

test("the gate hook is installed by default and left out with --no-gate", () => {
  const w = world();
  install(base(w, ["claude"]));
  const settings = () => JSON.parse(readFileSync(join(w.home, ".claude/settings.json"), "utf8"));
  assert.ok(settings().hooks.PreToolUse);
  install({ ...base(w, ["claude"]), gate: false });
  assert.equal(settings().hooks.PreToolUse, undefined);
  assert.ok(settings().hooks.PostToolUse);
  assert.equal(entryOf(w.home, "claude")?.gate, false);
  const dry = cli(w, "install", "--agent", "claude", "--no-gate", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
});

test("the default packs are dynamic and an option without a value is refused", () => {
  const w = world();
  assert.match(cli(w, "install", "--agent", "cursor", "--dry-run").stdout, /dynamic packs/);
  const missing = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "install", "--bin"],
    {
      encoding: "utf8",
      input: "",
    },
  );
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--bin needs a value/);
});

test("a corrupt install record stops install, uninstall and doctor with the file named", async () => {
  const w = world();
  const path = join(w.home, ".northstar/install.json");
  put(path, "{ nope");
  assert.throws(() => install(base(w, ["cursor"])), /install\.json is not valid JSON/);
  assert.throws(() => uninstallOf(w, ["cursor"]), /install\.json/);
  const checks = await doctor(doctorOptions(w));
  assert.ok(
    checks.some(
      (c) => c.name === "install record" && c.status === "fail" && /install\.json/.test(c.detail),
    ),
  );
  assert.equal(readFileSync(path, "utf8"), "{ nope");
  put(path, JSON.stringify({ installs: { x: { agent: "vim" } } }));
  assert.throws(() => readRecord(w.home), /is corrupt/);
});

test("a created flag survives a re-run so uninstall still removes what install made", () => {
  const w = world();
  const path = join(w.home, ".cursor/mcp.json");
  install(base(w, ["cursor"]));
  install({ ...base(w, ["cursor"]), packs: "dynamic" });
  assert.equal(entryOf(w.home, "cursor")?.files.find((f) => f.path === path)?.created, true);
  uninstallOf(w, ["cursor"]);
  assert.equal(existsSync(path), false);
});

test("uninstall puts back a file install replaced and a skill folder it displaced", () => {
  const w = world();
  const critic = join(w.home, ".claude/agents/northstar-critic.md");
  put(critic, "my own critic");
  const skill = join(w.home, ".claude/skills/northstar/SKILL.md");
  put(skill, "my own skill");
  const outcome = install(base(w, ["claude"]));
  assert.notEqual(readFileSync(critic, "utf8"), "my own critic");
  assert.ok(existsSync(join(w.home, ".northstar/backups/t0")));
  assert.ok(outcome.results.some((r) => r.target === skill.replace("/SKILL.md", "") && r.detail));
  uninstallOf(w, ["claude"]);
  assert.equal(readFileSync(critic, "utf8"), "my own critic");
  assert.equal(readFileSync(skill, "utf8"), "my own skill");
});

test("a change deep inside the installed skill is noticed and repaired", () => {
  const w = world();
  install(base(w, ["codex"]));
  const reference = join(w.home, ".agents/skills/northstar/references/typography.md");
  writeFileSync(reference, "tampered");
  const again = install(base(w, ["codex"]));
  assert.ok(again.results.some((r) => r.label === "skill" && r.status === "updated"));
  assert.notEqual(readFileSync(reference, "utf8"), "tampered");
});

test("an empty config left after removal is deleted, not written empty", () => {
  const w = world();
  install(base(w, ["gemini"]));
  uninstallOf(w, ["gemini"]);
  assert.equal(existsSync(join(w.home, ".gemini/settings.json")), false);
});

test("installs are recorded per scope and project, and uninstall only touches the one asked for", () => {
  const w = world();
  const other = mkdtempSync(join(scratch, "project-"));
  install({ ...base(w, ["cursor"]), scope: "project" });
  install({ ...base(w, ["cursor"]), scope: "project", project: other });
  install(base(w, ["cursor"]));
  const entries = Object.values(readRecord(w.home).installs);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries
      .filter((e) => e.scope === "project")
      .map((e) => e.project)
      .sort(),
    [w.project, other].sort(),
  );
  uninstallOf(w, ["cursor"], "project");
  assert.equal(existsSync(join(w.project, ".cursor/mcp.json")), false);
  assert.ok(existsSync(join(other, ".cursor/mcp.json")));
  assert.ok(existsSync(join(w.home, ".cursor/mcp.json")));
  assert.equal(Object.values(readRecord(w.home).installs).length, 2);
});

test("an agent whose install failed is not recorded", () => {
  const w = world();
  put(join(w.home, ".gemini/settings.json"), "{ broken");
  install(base(w, ["gemini", "cursor"]));
  assert.equal(entryOf(w.home, "gemini"), undefined);
  assert.ok(entryOf(w.home, "cursor"));
});

test("with the Northstar plugin installed claude gets no duplicate hooks, skill or critic", () => {
  const w = world();
  put(
    join(w.home, ".claude/plugins/installed_plugins.json"),
    JSON.stringify({ plugins: { "northstar@northstar": [{}] } }),
  );
  put(
    join(w.home, ".claude/settings.json"),
    JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: "x",
            hooks: [{ type: "command", command: "northstar hook post-edit --agent claude" }],
          },
        ],
      },
    }),
  );
  const outcome = install({ ...base(w, ["claude"]), plugin: true });
  assert.ok(outcome.notes.some((n) => /plugin/.test(n)));
  assert.equal(existsSync(join(w.home, ".claude/skills/northstar")), false);
  assert.equal(existsSync(join(w.home, ".claude/agents/northstar-critic.md")), false);
  assert.ok(w.calls.some((c) => c.slice(0, 3).join(" ") === "claude mcp add"));
  assert.equal(existsSync(join(w.home, ".claude/settings.json")), false);
});

test("doctor reports the browser helper, the pty module and the shell integration", async () => {
  const w = world();
  install(base(w, ["cursor"]));
  const script = join(w.home, "cli.js");
  put(script, "");
  const options = {
    ...doctorOptions(w),
    host: { node: process.execPath, script },
  };
  const named = (checks: Awaited<ReturnType<typeof doctor>>, name: string) =>
    checks.filter((c) => c.name === name);

  let checks = await doctor(options);
  assert.equal(named(checks, "chrome native host manifest")[0]?.status, "warn");
  assert.match(
    named(checks, "firefox native host manifest")[0]?.detail ?? "",
    /run northstar install/,
  );
  assert.equal(named(checks, "node-pty")[0]?.status, "ok");

  installHost({ home: w.home, node: process.execPath, script, extensionIds: [] });
  checks = await doctor(options);
  assert.equal(named(checks, "chrome native host manifest")[0]?.status, "ok");
  assert.equal(named(checks, "firefox native host manifest")[0]?.status, "ok");
  assert.equal(named(checks, "native host launcher target")[0]?.status, "ok");

  checks = await doctor({
    ...options,
    loadPty: async () => {
      throw new Error("no prebuild for this platform");
    },
  });
  assert.equal(named(checks, "node-pty")[0]?.status, "fail");
  assert.match(named(checks, "node-pty")[0]?.detail ?? "", /no prebuild/);
});

test("doctor fails the hook check when the scan finds nothing in a fixture with a known error", async () => {
  const w = world();
  const checks = await doctor({ ...doctorOptions(w), scanHook: () => undefined });
  assert.equal(checks.find((c) => c.name === "hook")?.status, "fail");
});

test("doctor compares json configs by value, so formatting alone is not drift", async () => {
  const w = world();
  install(base(w, ["cursor"]));
  const path = join(w.home, ".cursor/mcp.json");
  writeFileSync(path, JSON.stringify(JSON.parse(readFileSync(path, "utf8"))));
  const checks = await doctor(doctorOptions(w));
  assert.equal(checks.find((c) => c.name === "cursor MCP server")?.status, "ok");
});

test("install writes the core skill and every workflow skill, doctor reads each one and uninstall removes them", async () => {
  const w = world();
  install(base(w, ["claude"]));
  const names = [
    "northstar",
    "northstar-build",
    "northstar-refine",
    "northstar-finish",
    "northstar-review",
  ];
  for (const name of names) {
    const file = join(w.home, ".claude/skills", name, "SKILL.md");
    assert.ok(existsSync(file), name);
    assert.match(readFileSync(file, "utf8"), new RegExp(`^name: ${name}$`, "m"));
  }
  assert.ok(existsSync(join(w.home, ".claude/skills/northstar/references/INDEX.md")));

  const checks = await doctor(doctorOptions(w));
  const skillChecks = checks.filter((c) => c.name.startsWith("claude skill"));
  assert.ok(skillChecks.length >= names.length);
  assert.ok(skillChecks.every((c) => c.status === "ok"));

  uninstall({ ...base(w, ["claude"]) });
  for (const name of names)
    assert.equal(existsSync(join(w.home, ".claude/skills", name)), false, name);
});
