import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { claudeFeedback } from "../src/cli/hook.js";
import { resolveInside } from "../src/detect.js";
import { createMcpServer } from "../src/server.js";
import { CommentStore } from "../src/store.js";

const FIXTURES = resolve("../packages/detector/fixtures");
const BAD =
  '<h1 className="bg-gradient-to-r from-pink-500 to-orange-400 bg-clip-text text-transparent">x</h1>';

let root: string;
let client: Client;

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

function text(result: CallResult): string {
  return (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-detect-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/Hero.tsx"), BAD);
  await writeFile(join(root, "src/Clean.tsx"), '<h1 className="text-4xl">x</h1>');
  const server = createMcpServer(new CommentStore(root), undefined, undefined, {
    root,
    packs: "all",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

function cli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    encoding: "utf8",
  });
}

test("slop_scan reports errors with file, line and rule, and a clean file passes", async () => {
  const bad = text(
    await client.callTool({ name: "slop_scan", arguments: { paths: ["src/Hero.tsx"] } }),
  );
  assert.match(bad, /1 errors/);
  assert.match(bad, /src\/Hero\.tsx:1 NS-SLOP-GRADIENT-TEXT error/);
  const clean = text(
    await client.callTool({ name: "slop_scan", arguments: { paths: ["src/Clean.tsx"] } }),
  );
  assert.match(clean, /Clean\./);
});

test("slop_scan refuses paths outside the project root", async () => {
  const result = await client.callTool({ name: "slop_scan", arguments: { paths: ["../../etc"] } });
  assert.equal(result.isError, true);
  assert.match(text(result), /outside the project root/);
  assert.throws(() => resolveInside(root, "/etc/passwd"), /outside/);
  assert.equal(resolveInside(root, join(root, "src/a.tsx")), "src/a.tsx");
});

test("slop_scan honours DESIGN.md allow entries and mode", async () => {
  await writeFile(
    join(root, "DESIGN.md"),
    '---\nname: Acme\ncolors:\n  primary: "#112233"\nnorthstar:\n  mode: experience\n  allow:\n    - { rule: NS-SLOP-GRADIENT-TEXT, scope: src/** }\n---\n',
  );
  const out = text(await client.callTool({ name: "slop_scan", arguments: { paths: ["src"] } }));
  assert.match(out, /experience mode: 0 errors/);
});

test("explain_rule gives the reasoning and the related conflict, and rejects unknown ids", async () => {
  const out = text(
    await client.callTool({ name: "explain_rule", arguments: { id: "ns-slop-gradient-text" } }),
  );
  assert.match(out, /NS-SLOP-GRADIENT-TEXT/);
  assert.match(out, /Conflict resolved: Gradient text/);
  const missing = await client.callTool({
    name: "explain_rule",
    arguments: { id: "NS-NOPE-NOPE" },
  });
  assert.equal(missing.isError, true);
});

test("the detect command exits 1 on errors and 0 on a clean tree", () => {
  const fail = cli("detect", join(FIXTURES, "fail"), "--root", FIXTURES, "--format", "json");
  assert.equal(fail.status, 1);
  assert.ok(
    JSON.parse(fail.stdout).some((f: { rule: string }) => f.rule === "NS-SLOP-GRADIENT-TEXT"),
  );
  const pass = cli("detect", join(FIXTURES, "pass"), "--root", FIXTURES);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
});

test("the detect command validates its options", () => {
  assert.equal(cli("detect", "--format", "xml").status, 2);
  assert.equal(cli("detect", "--mode", "loud").status, 2);
  assert.equal(cli("detect", "--bogus").status, 2);
});

test("the claude hook blocks on errors, stays silent on clean edits and ignores other tools", () => {
  const blocked = claudeFeedback(
    { tool_name: "Edit", tool_input: { file_path: join(root, "src/Hero.tsx") }, cwd: root },
    root,
  );
  assert.ok(blocked);
  const parsed = JSON.parse(blocked);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.reason, /NS-SLOP-GRADIENT-TEXT/);

  assert.equal(
    claudeFeedback(
      { tool_name: "Write", tool_input: { file_path: join(root, "src/Clean.tsx") }, cwd: root },
      root,
    ),
    undefined,
  );
  assert.equal(claudeFeedback({ tool_name: "Bash", tool_input: {}, cwd: root }, root), undefined);
  assert.equal(
    claudeFeedback({ tool_name: "Edit", tool_input: { file_path: "/etc/hosts" }, cwd: root }, root),
    undefined,
  );
  assert.equal(
    claudeFeedback(
      { tool_name: "Edit", tool_input: { file_path: join(root, "README.md") }, cwd: root },
      root,
    ),
    undefined,
  );
});

test("the hook command never fails an edit, even on garbage input", () => {
  for (const input of ["not json", "", "{}", '{"tool_name":"Edit"}']) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "hook", "post-edit"],
      {
        input,
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, input);
    assert.equal(result.stdout, "", input);
  }
});

import { feedbackText, filesFor, render } from "../src/cli/hook.js";

test("each agent's hook input is read and its feedback is rendered in its own dialect", () => {
  const codex = {
    tool_name: "apply_patch",
    cwd: root,
    tool_input: { command: "*** Begin Patch\n*** Update File: src/Hero.tsx\n@@\n*** End Patch" },
  };
  assert.deepEqual(filesFor("codex", codex), ["src/Hero.tsx"]);
  const text = feedbackText("codex", codex, root);
  assert.match(text ?? "", /NS-SLOP-GRADIENT-TEXT/);
  assert.equal(
    JSON.parse(render("codex", text ?? "")).hookSpecificOutput.hookEventName,
    "PostToolUse",
  );

  const gemini = {
    tool_name: "write_file",
    cwd: root,
    tool_input: { file_path: join(root, "src/Hero.tsx") },
  };
  assert.equal(
    JSON.parse(render("gemini", feedbackText("gemini", gemini, root) ?? "")).hookSpecificOutput
      .hookEventName,
    "AfterTool",
  );
  assert.equal(
    feedbackText("gemini", { ...gemini, tool_name: "run_shell_command" }, root),
    undefined,
  );

  const opencode = { cwd: root, tool_input: { file_path: "src/Hero.tsx" } };
  assert.match(
    render("opencode", feedbackText("opencode", opencode, root) ?? ""),
    /^Northstar found UI errors in src\/Hero\.tsx/,
  );
  assert.equal(render("cursor", "x"), "");
});

test("the hook command accepts every agent name and ignores an unknown one", () => {
  for (const agent of ["codex", "gemini", "opencode", "cursor", "nope"]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "hook", "post-edit", "--agent", agent],
      {
        input: "garbage",
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, agent);
    assert.equal(result.stdout, "", agent);
  }
});
