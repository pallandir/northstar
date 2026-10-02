import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  type Conflict,
  findConflicts,
  installedFor,
  remove,
  restore,
} from "../mcp/src/install/conflicts.js";
import { writeRecord } from "../mcp/src/install/record.js";
import { CLI_ENTRY } from "./helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "northstar-conflicts-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function write(path: string, content = "x"): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function fakeHome(): string {
  const home = mkdtempSync(join(scratch, "home-"));
  write(join(home, ".claude/skills/impeccable/SKILL.md"));
  write(join(home, ".agents/skills/impeccable/SKILL.md"));
  write(join(home, ".claude/skills/wondelai-top-design/SKILL.md"));
  symlinkSync("../.agents/skills/frontend-design", join(home, ".claude/skills/frontend-design"));
  write(
    join(home, ".claude/skills/resolve-comments/SKILL.md"),
    "Resolve UI comments left through Northstar",
  );
  for (const keep of [
    "redline-design-score",
    "strix-pentest",
    "vue-best-practices",
    "jensen-debrief",
  ]) {
    write(join(home, ".claude/skills", keep, "SKILL.md"), keep);
  }
  write(join(home, ".claude/agents/impeccable-documenter.md"));
  write(join(home, ".claude/agents/architect.md"));
  write(
    join(home, ".claude/plugins/installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "ui-ux-pro-max@ui-ux-pro-max-skill": [{}],
        "frontend-design@claude-plugins-official": [{}],
        "context7@claude-plugins-official": [{}],
      },
    }),
  );
  return home;
}

const names = (conflicts: Conflict[]) =>
  conflicts.map((c) => `${c.kind}:${c.owner}:${c.name}`).sort();

test("only the allowlisted skills, agents and plugins are found, including a broken symlink", () => {
  const found = findConflicts(fakeHome());
  assert.deepEqual(names(found), [
    "agent:claude:impeccable-documenter.md",
    "plugin:claude:frontend-design@claude-plugins-official",
    "plugin:claude:ui-ux-pro-max@ui-ux-pro-max-skill",
    "skill:claude:frontend-design",
    "skill:claude:impeccable",
    "skill:claude:resolve-comments",
    "skill:claude:wondelai-top-design",
    "skill:shared:impeccable",
  ]);
  assert.equal(found.find((c) => c.name === "frontend-design" && c.kind === "skill")?.broken, true);
});

test("a resolve-comments skill that does not mention northstar is left alone", () => {
  const home = fakeHome();
  write(
    join(home, ".claude/skills/resolve-comments/SKILL.md"),
    "Resolve review comments on pull requests",
  );
  assert.ok(!findConflicts(home).some((c) => c.name === "resolve-comments"));
});

test("removal moves skills to quarantine, uninstalls plugins through the runner, and spares others", () => {
  const home = fakeHome();
  const calls: string[][] = [];
  const result = remove(home, findConflicts(home), "t1", (command, args) =>
    calls.push([command, ...args]),
  );

  assert.equal(result.failed.length, 0);
  assert.deepEqual(calls.sort(), [
    ["claude", "plugin", "uninstall", "frontend-design@claude-plugins-official"],
    ["claude", "plugin", "uninstall", "ui-ux-pro-max@ui-ux-pro-max-skill"],
  ]);
  assert.ok(!existsSync(join(home, ".claude/skills/impeccable")));
  assert.ok(existsSync(join(home, ".northstar/quarantine/t1/claude/skill/impeccable/SKILL.md")));
  assert.ok(
    lstatSync(join(home, ".northstar/quarantine/t1/claude/skill/frontend-design")).isSymbolicLink(),
  );
  for (const keep of [
    "redline-design-score",
    "strix-pentest",
    "vue-best-practices",
    "jensen-debrief",
  ]) {
    assert.ok(existsSync(join(home, ".claude/skills", keep, "SKILL.md")), keep);
  }
  assert.ok(existsSync(join(home, ".claude/agents/architect.md")));
  assert.deepEqual(
    findConflicts(home).filter((c) => c.kind !== "plugin"),
    [],
  );
});

test("a quarantine can be restored and a restore never overwrites", () => {
  const home = fakeHome();
  remove(home, findConflicts(home), "t2", () => undefined);
  assert.ok(!existsSync(join(home, ".claude/skills/impeccable")));

  const first = restore(home, "t2");
  assert.equal(first.failed.length, 0);
  assert.ok(existsSync(join(home, ".claude/skills/impeccable/SKILL.md")));
  assert.ok(lstatSync(join(home, ".claude/skills/frontend-design")).isSymbolicLink());

  assert.throws(() => restore(home, "missing"), /no quarantine/);
  remove(home, findConflicts(home), "t3", () => undefined);
  write(join(home, ".claude/skills/impeccable/SKILL.md"), "new");
  const second = restore(home, "t3");
  assert.ok(second.failed.some((f) => f.startsWith("impeccable:")));
  assert.equal(
    existsSync(join(home, ".northstar/quarantine/t3/claude/skill/impeccable/SKILL.md")),
    true,
  );
});

test("a failing uninstall is reported and does not stop the other removals", () => {
  const home = fakeHome();
  const result = remove(home, findConflicts(home), "t4", (_command, args) => {
    if (args.includes("ui-ux-pro-max@ui-ux-pro-max-skill")) throw new Error("claude not found");
  });
  assert.ok(result.failed.some((f) => /ui-ux-pro-max.*claude not found/.test(f)));
  assert.ok(result.uninstalled.includes("frontend-design@claude-plugins-official"));
  assert.ok(result.moved.length >= 4);
});

test("removal is gated on an install record for the owning agent", () => {
  const home = fakeHome();
  const conflicts = findConflicts(home);
  const claudeSkill = conflicts.find((c) => c.owner === "claude") as Conflict;
  const shared = conflicts.find((c) => c.owner === "shared") as Conflict;
  assert.equal(installedFor(home, claudeSkill), false);

  const record = (agent: "claude" | "codex") => ({
    agent,
    installedAt: "now",
    version: "2.2.0",
    scope: "user" as const,
    packs: "all" as const,
    files: [],
  });
  writeRecord(home, { installs: { "claude:user": record("claude") } });
  assert.equal(installedFor(home, claudeSkill), true);
  assert.equal(installedFor(home, shared), false);
  writeRecord(home, {
    installs: { "claude:user": record("claude"), "codex:user": record("codex") },
  });
  assert.equal(installedFor(home, shared), true);
});

import { spawnSync } from "node:child_process";

function cli(home: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, "conflicts", "--home", home, ...args],
    {
      encoding: "utf8",
      input: "",
    },
  );
}

test("the conflicts command lists, refuses before an install, and removes with --yes after one", () => {
  const home = fakeHome();
  const listed = cli(home);
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /skill impeccable \(claude\)/);
  assert.match(listed.stdout, /broken link/);
  assert.match(listed.stdout, /--remove/);

  const gated = cli(home, "--remove", "--yes");
  assert.equal(gated.status, 1);
  assert.match(gated.stderr, /run northstar install first/);
  assert.ok(existsSync(join(home, ".claude/skills/impeccable")));

  writeRecord(home, {
    installs: {
      "claude:user": {
        agent: "claude",
        installedAt: "now",
        version: "2.2.0",
        scope: "user",
        packs: "all",
        files: [],
      },
    },
  });
  const noTty = cli(home, "--remove");
  assert.equal(noTty.status, 2);
  assert.match(noTty.stderr, /needs a terminal/);
});

test("the conflicts command rejects unknown options and unknown restores", () => {
  const home = fakeHome();
  assert.equal(cli(home, "--nope").status, 2);
  const missing = cli(home, "--restore", "nothing");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no quarantine/);
});

test("a quarantine name that could leave the quarantine folder is refused", () => {
  const home = fakeHome();
  for (const stamp of ["../escape", "a/b", "..", ""]) {
    assert.throws(() => remove(home, [], stamp, () => undefined), /not a valid quarantine name/);
    assert.throws(() => restore(home, stamp), /not a valid quarantine name/);
  }
});

test("the manifest lists every item moved so far even when a later one fails", () => {
  const home = fakeHome();
  const [first] = findConflicts(home).filter((c) => c.kind === "skill");
  const ghost: Conflict = {
    kind: "skill",
    name: "ghost",
    owner: "claude",
    path: join(home, "nowhere/ghost"),
    broken: false,
  };
  const result = remove(home, [first as Conflict, ghost], "t5", () => undefined);
  assert.equal(result.failed.length, 1);
  const manifest = JSON.parse(
    readFileSync(join(home, ".northstar/quarantine/t5/manifest.json"), "utf8"),
  );
  assert.equal(manifest.length, 1);
});

test("a corrupt plugin list or manifest is an error naming the file, not an empty result", () => {
  const home = fakeHome();
  write(join(home, ".claude/plugins/installed_plugins.json"), "{ nope");
  assert.throws(() => findConflicts(home), /installed_plugins\.json is not valid JSON/);
  const other = fakeHome();
  remove(other, findConflicts(other), "t6", () => undefined);
  write(join(other, ".northstar/quarantine/t6/manifest.json"), "{ nope");
  assert.throws(() => restore(other, "t6"), /manifest\.json is not valid JSON/);
});

test("a manifest entry that points outside the quarantine or the home is not restored", () => {
  const home = fakeHome();
  const dir = join(home, ".northstar/quarantine/t7");
  write(
    join(dir, "manifest.json"),
    JSON.stringify([
      { from: join(home, "x"), to: "/etc/passwd", kind: "skill", name: "a" },
      { from: "/tmp/elsewhere", to: join(dir, "b"), kind: "skill", name: "b" },
    ]),
  );
  const result = restore(home, "t7");
  assert.equal(result.restored.length, 0);
  assert.equal(result.failed.length, 2);
});
