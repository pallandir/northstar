import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_NAMES,
  ConfigError,
  type Op,
  type PlanContext,
  hookCommand,
  planAgent,
  removeBlock,
  removeTomlTables,
  upsertBlock,
  upsertToml,
} from "../src/index.js";

function ctx(agent: PlanContext["agent"], scope: PlanContext["scope"] = "user"): PlanContext {
  return {
    agent,
    scope,
    home: "/home/u",
    project: "/work/app",
    version: "2.2.0",
    packs: "all",
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
    assert.equal(merged.mcpServers.northstar.env.NORTHSTAR_PACKS, "all");
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
  assert.equal(twice.hooks.PostToolUse[1].matcher, "Edit|Write|MultiEdit");
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
    'NORTHSTAR_PACKS = "dynamic"',
    "",
    "[mcp_servers.other]",
    'command = "keep"',
    "",
  ].join("\n");
  const out = op.apply(existing);
  assert.match(out, /model = "gpt-5"/);
  assert.match(out, /\[mcp_servers\.other\]\ncommand = "keep"/);
  assert.equal(out.match(/\[mcp_servers\.northstar\]/g)?.length, 1);
  assert.match(out, /NORTHSTAR_PACKS = "all"/);
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
  assert.deepEqual(user.run.slice(0, 4), ["claude", "mcp", "add", "--env"]);
  assert.ok(user.run.includes("NORTHSTAR_PACKS=all"));
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
  assert.ok(file.content.includes(JSON.stringify(hookCommand("2.2.0", "opencode"))));
  const config = merges(planAgent(ctx("opencode")).ops)[0] as Extract<Op, { kind: "merge" }>;
  const parsed = JSON.parse(config.apply(undefined));
  assert.deepEqual(parsed.mcp.northstar.command, ["npx", "-y", "@pallandir/northstar"]);
  assert.equal(parsed.mcp.northstar.environment.NORTHSTAR_PACKS, "all");
});

test("the hook command prefers a global install, falls back to a pinned npx and never fails", () => {
  const command = hookCommand("2.2.0", "gemini");
  assert.match(command, /command -v northstar/);
  assert.match(command, /npx -y @pallandir\/northstar@2\.2\.0 hook post-edit --agent gemini/);
  assert.match(command, /\|\| true'$/);
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

test("both the global and the pinned npx form of the command are recognised as ours", () => {
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
  assert.match(out[0].hooks[0].command, /northstar@2\.2\.0/);
});

test("extension ids become a trusted origin list in every server entry", () => {
  const withIds = {
    ...ctx("codex"),
    extensionIds: ["pemllnphnlcnkolginljldoejphkmbba", "abcdefghijklmnopabcdefghijklmnop"],
  };
  const expected =
    "chrome-extension://pemllnphnlcnkolginljldoejphkmbba,chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  const toml = merges(planAgent(withIds).ops).find((o) =>
    o.path.endsWith("config.toml"),
  ) as Extract<Op, { kind: "merge" }>;
  assert.match(toml.apply(undefined), new RegExp(`NORTHSTAR_EXTRA_ORIGINS = "${expected}"`));
  const cursor = merges(planAgent({ ...withIds, agent: "cursor" }).ops)[0] as Extract<
    Op,
    { kind: "merge" }
  >;
  assert.equal(
    JSON.parse(cursor.apply(undefined)).mcpServers.northstar.env.NORTHSTAR_EXTRA_ORIGINS,
    expected,
  );
  const claude = planAgent({ ...withIds, agent: "claude" }).ops.find(
    (o) => o.kind === "command",
  ) as Extract<Op, { kind: "command" }>;
  assert.ok(claude.run.includes(`NORTHSTAR_EXTRA_ORIGINS=${expected}`));
  const opencode = merges(planAgent({ ...withIds, agent: "opencode" }).ops)[0] as Extract<
    Op,
    { kind: "merge" }
  >;
  assert.equal(
    JSON.parse(opencode.apply(undefined)).mcp.northstar.environment.NORTHSTAR_EXTRA_ORIGINS,
    expected,
  );
  const plain = merges(planAgent({ ...ctx("cursor") }).ops)[0] as Extract<Op, { kind: "merge" }>;
  assert.equal(
    JSON.parse(plain.apply(undefined)).mcpServers.northstar.env.NORTHSTAR_EXTRA_ORIGINS,
    undefined,
  );
});

test("claude gets a design gate before edits and a scan after, and both are removed together", () => {
  const op = merges(planAgent(ctx("claude")).ops).find((o) =>
    o.path.endsWith("settings.json"),
  ) as Extract<Op, { kind: "merge" }>;
  const written = JSON.parse(op.apply(undefined)).hooks;
  assert.equal(written.PreToolUse[0].matcher, "Edit|Write|MultiEdit");
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
