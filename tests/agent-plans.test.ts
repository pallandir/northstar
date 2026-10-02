import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  AGENT_NAMES,
  ConfigError,
  type Op,
  type PlanContext,
  hookArgv,
  hookCommand,
  planAgent,
  removeBlock,
  removeTomlTables,
  upsertBlock,
  upsertHook,
  upsertToml,
} from "../mcp/src/install/plans/index.js";

function ctx(agent: PlanContext["agent"], scope: PlanContext["scope"] = "user"): PlanContext {
  return {
    agent,
    scope,
    home: "/home/u",
    project: "/work/app",
    version: "2.2.0",
    snippet: "## Northstar UI design\n\nUse the skill.",
    critic: "---\nname: northstar-critic\n---\n",
  };
}

const merges = (ops: Op[]) =>
  ops.filter((op): op is Extract<Op, { kind: "merge" }> => op.kind === "merge");

test("every agent and scope plans merges that are idempotent and fully reversible", () => {
  for (const agent of AGENT_NAMES) {
    for (const scope of ["user", "project"] as const) {
      const plan = planAgent(ctx(agent, scope));
      assert.ok(
        plan.ops.some((op) => op.kind === "skill"),
        `${agent} ${scope} installs the skill`,
      );
      for (const op of merges(plan.ops)) {
        const once = op.apply(undefined);
        assert.equal(op.apply(once), once, `${agent} ${scope} ${op.path} is idempotent`);
        assert.equal(op.remove(once).trim(), "", `${agent} ${scope} ${op.path} removes cleanly`);
      }
    }
  }
});

test("json merges keep foreign keys and other servers through install and removal", () => {
  const existing = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } });
  for (const agent of ["cursor", "gemini"] as const) {
    const op = merges(planAgent(ctx(agent)).ops).find((o) => o.path.endsWith(".json")) as Extract<
      Op,
      { kind: "merge" }
    >;
    const merged = JSON.parse(op.apply(existing));
    assert.equal(merged.theme, "dark");
    assert.deepEqual(merged.mcpServers.other, { command: "x" });
    assert.equal(merged.mcpServers.northstar.command, "npx");
    assert.deepEqual(merged.mcpServers.northstar.args, ["-y", "@pallandir/northstar@2.2.0"]);
    assert.equal(merged.mcpServers.northstar.env, undefined);
    const removed = JSON.parse(op.remove(op.apply(existing)));
    assert.equal(removed.theme, "dark");
    assert.deepEqual(removed.mcpServers, { other: { command: "x" } });
    assert.equal(removed.hooks, undefined);
  }
});

test("a config that is not valid JSON is refused instead of overwritten", () => {
  const op = merges(planAgent(ctx("cursor")).ops)[0] as Extract<Op, { kind: "merge" }>;
  assert.throws(() => op.apply("{ not json"), ConfigError);
  assert.throws(() => op.apply("[1,2]"), /JSON object/);
  assert.equal(op.apply("   "), op.apply(undefined));
});

test("hooks are added once, keep other hooks and are removed on uninstall", () => {
  const op = merges(planAgent(ctx("claude")).ops).find((o) =>
    o.path.endsWith("settings.json"),
  ) as Extract<Op, { kind: "merge" }>;
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "audit.sh" }] };
  const existing = JSON.stringify({ hooks: { PostToolUse: [other] }, model: "x" });
  const once = op.apply(existing);
  const twice = JSON.parse(op.apply(once));
  assert.equal(twice.hooks.PostToolUse.length, 2);
  assert.deepEqual(twice.hooks.PostToolUse[0], other);
  assert.equal(twice.hooks.PostToolUse[1].matcher, "Edit|Write|MultiEdit|NotebookEdit");
  const removed = JSON.parse(op.remove(once));
  assert.deepEqual(removed.hooks.PostToolUse, [other]);
  assert.equal(removed.model, "x");
});

test("gemini hooks use milliseconds and codex hooks use seconds and the patch tool", () => {
  const gemini = merges(planAgent(ctx("gemini")).ops)[0] as Extract<Op, { kind: "merge" }>;
  const g = JSON.parse(gemini.apply(undefined)).hooks.AfterTool[0];
  assert.equal(g.matcher, "write_file|replace");
  assert.equal(g.hooks[0].timeout, 20000);
  const codex = merges(planAgent(ctx("codex")).ops).find((o) =>
    o.path.endsWith("hooks.json"),
  ) as Extract<Op, { kind: "merge" }>;
  const c = JSON.parse(codex.apply(undefined)).hooks.PostToolUse[0];
  assert.match(c.matcher, /apply_patch/);
  assert.equal(c.hooks[0].timeout, 30);
});

test("the codex toml table is replaced in place and other tables survive", () => {
  const op = merges(planAgent(ctx("codex")).ops).find((o) =>
    o.path.endsWith("config.toml"),
  ) as Extract<Op, { kind: "merge" }>;
  const existing = [
    'model = "gpt-5"',
    "",
    "[mcp_servers.northstar]",
    'command = "old"',
    "",
    "[mcp_servers.northstar.env]",
    'OLD_SETTING = "x"',
    "",
    "[mcp_servers.other]",
    'command = "keep"',
    "",
  ].join("\n");
  const out = op.apply(existing);
  assert.match(out, /model = "gpt-5"/);
  assert.match(out, /\[mcp_servers\.other\]\ncommand = "keep"/);
  assert.equal(out.match(/\[mcp_servers\.northstar\]/g)?.length, 1);
  assert.doesNotMatch(out, /OLD_SETTING|mcp_servers\.northstar\.env/);
  assert.doesNotMatch(out, /command = "old"/);
  assert.match(out, /startup_timeout_sec = 30/);
  const removed = op.remove(out);
  assert.doesNotMatch(removed, /northstar/);
  assert.match(removed, /model = "gpt-5"/);
  assert.match(removed, /mcp_servers\.other/);
});

test("toml helpers do not touch a table that merely shares a prefix", () => {
  const text = '[mcp_servers.northstar-extra]\ncommand = "x"\n';
  assert.equal(removeTomlTables(text, "mcp_servers.northstar"), text);
  assert.match(
    upsertToml(text, "mcp_servers.northstar", '[mcp_servers.northstar]\ncommand = "y"'),
    /northstar-extra/,
  );
});

test("the context block is appended once, replaced in place and removed without a trace", () => {
  const original = "# Project rules\n\nBe kind.\n";
  const once = upsertBlock(original, "first");
  assert.match(once, /Be kind\./);
  const replaced = upsertBlock(once, "second");
  assert.equal(replaced.match(/northstar:begin/g)?.length, 1);
  assert.match(replaced, /second/);
  assert.doesNotMatch(replaced, /first/);
  assert.equal(removeBlock(replaced), original);
  assert.equal(removeBlock(original), original);
  assert.equal(removeBlock(upsertBlock(undefined, "x")).trim(), "");
});

test("cursor says why it has no hook and adds the always on rule only for a project", () => {
  const user = planAgent(ctx("cursor", "user"));
  assert.ok(user.notes.some((n) => /no edit hook/.test(n)));
  assert.ok(!user.ops.some((op) => op.kind === "file"));
  const project = planAgent(ctx("cursor", "project"));
  const rule = project.ops.find((op) => op.kind === "file") as Extract<Op, { kind: "file" }>;
  assert.match(rule.path, /\.cursor\/rules\/northstar\.mdc$/);
  assert.match(rule.content, /alwaysApply: true/);
});

test("claude registers the server through its own cli at user scope and a file at project scope", () => {
  const user = planAgent(ctx("claude", "user")).ops.find((op) => op.kind === "command") as Extract<
    Op,
    { kind: "command" }
  >;
  assert.deepEqual(user.run.slice(0, 4), ["claude", "mcp", "add", "--transport"]);
  assert.ok(!user.run.includes("--env"));
  assert.deepEqual(user.undo, ["claude", "mcp", "remove", "northstar", "--scope", "user"]);
  const project = merges(planAgent(ctx("claude", "project")).ops).find(
    (o) => o.path === "/work/app/.mcp.json",
  );
  assert.ok(project);
});

test("agents that read the shared skills folder install to the same place", () => {
  const path = (agent: PlanContext["agent"]) =>
    planAgent(ctx(agent)).ops.find((op) => op.kind === "skill")?.path;
  assert.equal(path("codex"), "/home/u/.agents/skills/northstar");
  assert.equal(path("cursor"), path("codex"));
  assert.equal(path("gemini"), path("codex"));
  assert.equal(path("claude"), "/home/u/.claude/skills/northstar");
  assert.equal(path("opencode"), "/home/u/.config/opencode/skills/northstar");
});

test("opencode installs a plugin that appends scan feedback and pins the hook command", () => {
  const file = planAgent(ctx("opencode")).ops.find((op) => op.kind === "file") as Extract<
    Op,
    { kind: "file" }
  >;
  assert.match(file.path, /plugins\/northstar\.ts$/);
  assert.match(file.content, /"tool\.execute\.after"/);
  assert.match(file.content, /output\.output = /);
  assert.ok(file.content.includes(JSON.stringify(hookArgv(ctx("opencode"), "opencode"))));
  assert.doesNotMatch(file.content, /"sh"/);
  const config = merges(planAgent(ctx("opencode")).ops)[0] as Extract<Op, { kind: "merge" }>;
  const parsed = JSON.parse(config.apply(undefined));
  assert.deepEqual(parsed.mcp.northstar.command, ["npx", "-y", "@pallandir/northstar@2.2.0"]);
  assert.equal(parsed.mcp.northstar.environment, undefined);
});

const scratch = mkdtempSync(join(tmpdir(), "northstar-hook-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("the hook command is a node launcher with argv, pinned like the server, with no shell chain", () => {
  const command = hookCommand(ctx("gemini"), "gemini");
  assert.match(command, /^node -e "/);
  assert.match(command, / npx -y @pallandir\/northstar@2\.2\.0 hook post-edit --agent gemini$/);
  assert.doesNotMatch(command, /sh -c|\|\| true|command -v/);
  const argv = hookArgv(ctx("gemini"), "gemini", "pre-edit");
  assert.deepEqual(argv.slice(0, 2), ["node", "-e"]);
  assert.deepEqual(argv.slice(3), [
    "npx",
    "-y",
    "@pallandir/northstar@2.2.0",
    "hook",
    "pre-edit",
    "--agent",
    "gemini",
  ]);
});

test("the launcher runs the installed binary with the hook arguments and keeps its exit code", () => {
  const bin = join(scratch, "cli.js");
  writeFileSync(
    bin,
    "process.stdout.write(process.argv.slice(2).join(' '));process.exit(Number(process.env.EXIT ?? 0));",
  );
  const argv = hookArgv({ ...ctx("claude"), launch: { command: "node", args: [bin] } }, "claude");
  const ok = spawnSync(argv[0] as string, argv.slice(1), { encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "hook post-edit --agent claude");
  const failing = spawnSync(argv[0] as string, argv.slice(1), {
    encoding: "utf8",
    env: { ...process.env, EXIT: "3" },
  });
  assert.equal(failing.status, 3);
});

test("the launcher exits non zero with a clear message when the binary is missing", () => {
  const missing = join(scratch, "gone.js");
  const argv = hookArgv(
    { ...ctx("claude"), launch: { command: "node", args: [missing] } },
    "claude",
  );
  const result = spawnSync(argv[0] as string, argv.slice(1), { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Northstar is not installed at .*gone\.js\. Run northstar install again\./,
  );
});

test("the launcher works through a shell with a path that has spaces", () => {
  const dir = join(scratch, "with space");
  const bin = join(dir, "cli.js");
  spawnSync("mkdir", ["-p", dir]);
  writeFileSync(bin, "process.stdout.write('ran');");
  const command = hookCommand(
    { ...ctx("claude"), launch: { command: "node", args: [bin] } },
    "claude",
  );
  const result = spawnSync("sh", ["-c", command], { encoding: "utf8" });
  assert.equal(result.stdout, "ran");
});

test("upsertHook replaces our entry where it was instead of moving it to the end", () => {
  const ours = {
    matcher: "Edit",
    hooks: [{ type: "command" as const, command: "northstar hook post-edit --agent claude" }],
  };
  const before = { matcher: "A", hooks: [{ type: "command" as const, command: "a.sh" }] };
  const after = { matcher: "B", hooks: [{ type: "command" as const, command: "b.sh" }] };
  const root: Record<string, unknown> = { hooks: { PostToolUse: [before, ours, after] } };
  const next = {
    matcher: "Edit|Write",
    hooks: [{ type: "command" as const, command: "northstar hook post-edit --agent claude" }],
  };
  upsertHook(root, "PostToolUse", next);
  assert.deepEqual((root.hooks as { PostToolUse: unknown[] }).PostToolUse, [before, next, after]);
});

test("removing a toml table leaves comments and other tables byte for byte", () => {
  const text = [
    "# global",
    'model = "x"',
    "",
    "[mcp_servers.northstar]",
    'command = "a"',
    "",
    "[mcp_servers.northstar.env]",
    'K = "v"',
    "",
    "",
    "# about other",
    "[mcp_servers.other]",
    'command = "keep"',
    "",
    "",
    "",
    "[tail]",
    "x = 1",
    "",
  ].join("\n");
  const out = removeTomlTables(text, "mcp_servers.northstar");
  assert.equal(
    out,
    [
      "# global",
      'model = "x"',
      "",
      "# about other",
      "[mcp_servers.other]",
      'command = "keep"',
      "",
      "",
      "",
      "[tail]",
      "x = 1",
      "",
    ].join("\n"),
  );
});

test("with the Northstar plugin installed claude registers no second copy of hooks, skill or critic", () => {
  const plan = planAgent({ ...ctx("claude"), plugin: true });
  assert.deepEqual(
    plan.ops.map((op) => op.kind),
    ["command", "merge"],
  );
  assert.ok(plan.notes.some((n) => /plugin/.test(n)));
  const op = merges(plan.ops)[0] as Extract<Op, { kind: "merge" }>;
  const present = JSON.stringify({
    hooks: {
      PostToolUse: [
        {
          matcher: "x",
          hooks: [{ type: "command", command: "northstar hook post-edit --agent claude" }],
        },
      ],
    },
    keep: 1,
  });
  assert.deepEqual(JSON.parse(op.apply(present)), { keep: 1 });
});

test("hooks that merely mention northstar in a path survive install and uninstall", () => {
  const op = merges(planAgent(ctx("claude")).ops).find((o) =>
    o.path.endsWith("settings.json"),
  ) as Extract<Op, { kind: "merge" }>;
  const foreign = {
    matcher: "Edit",
    hooks: [{ type: "command", command: "bash /Users/x/projects/northstar/scripts/lint.sh" }],
  };
  const sharing = {
    matcher: "Write",
    hooks: [
      { type: "command", command: "echo mine" },
      { type: "command", command: "northstar hook post-edit --agent claude" },
    ],
  };
  const existing = JSON.stringify({ hooks: { PostToolUse: [foreign, sharing] } });
  const installed = JSON.parse(op.apply(existing)).hooks.PostToolUse;
  assert.deepEqual(installed[0], foreign);
  assert.deepEqual(installed[1].hooks, [{ type: "command", command: "echo mine" }]);
  assert.equal(installed.length, 3);
  const removed = JSON.parse(op.remove(op.apply(existing))).hooks.PostToolUse;
  assert.deepEqual(removed[0], foreign);
  assert.deepEqual(removed[1].hooks, [{ type: "command", command: "echo mine" }]);
  assert.equal(removed.length, 2);
});

test("an older command form of our hook is recognised and replaced", () => {
  const op = merges(planAgent(ctx("codex")).ops).find((o) =>
    o.path.endsWith("hooks.json"),
  ) as Extract<Op, { kind: "merge" }>;
  const old = {
    matcher: "x",
    hooks: [
      {
        type: "command",
        command: "npx -y @pallandir/northstar@2.0.0 hook post-edit --agent codex",
      },
    ],
  };
  const out = JSON.parse(op.apply(JSON.stringify({ hooks: { PostToolUse: [old] } }))).hooks
    .PostToolUse;
  assert.equal(out.length, 1);
  assert.match(out[0].hooks[0].command, /northstar@2\.2\.0 hook post-edit --agent codex/);
});

test("the server entry carries no environment at all", () => {
  const cursor = merges(planAgent(ctx("cursor")).ops)[0] as Extract<Op, { kind: "merge" }>;
  assert.equal(JSON.parse(cursor.apply(undefined)).mcpServers.northstar.env, undefined);
});

test("claude gets a design gate before edits and a scan after, and both are removed together", () => {
  const op = merges(planAgent(ctx("claude")).ops).find((o) =>
    o.path.endsWith("settings.json"),
  ) as Extract<Op, { kind: "merge" }>;
  const written = JSON.parse(op.apply(undefined)).hooks;
  assert.equal(written.PreToolUse[0].matcher, "Edit|Write|MultiEdit|NotebookEdit");
  assert.match(written.PreToolUse[0].hooks[0].command, /hook pre-edit --agent claude/);
  assert.match(written.PostToolUse[0].hooks[0].command, /hook post-edit --agent claude/);
  assert.equal(op.remove(op.apply(undefined)).trim(), "");

  const foreign = { matcher: "Bash", hooks: [{ type: "command", command: "audit.sh" }] };
  const existing = JSON.stringify({ hooks: { PreToolUse: [foreign] } });
  const kept = JSON.parse(op.remove(op.apply(existing)));
  assert.deepEqual(kept.hooks.PreToolUse, [foreign]);
});

test("the gate can be left out and is removed from a config that already has it", () => {
  const off = merges(planAgent({ ...ctx("claude"), gate: false }).ops).find((o) =>
    o.path.endsWith("settings.json"),
  ) as Extract<Op, { kind: "merge" }>;
  assert.equal(JSON.parse(off.apply(undefined)).hooks.PreToolUse, undefined);
  const on = merges(planAgent(ctx("claude")).ops).find((o) =>
    o.path.endsWith("settings.json"),
  ) as Extract<Op, { kind: "merge" }>;
  const reinstalled = JSON.parse(off.apply(on.apply(undefined)));
  assert.equal(reinstalled.hooks.PreToolUse, undefined);
  assert.ok(reinstalled.hooks.PostToolUse);
});
