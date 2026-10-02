import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { claudeFeedback } from "../mcp/src/cli/hook.js";
import { resolveInside } from "../mcp/src/lib/paths.js";
import { createMcpServer } from "../mcp/src/server.js";
import { CommentStore } from "../mcp/src/store.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/detector", import.meta.url));
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
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { react: "19.0.0" } }),
  );
  await writeFile(join(root, "src/Hero.tsx"), BAD);
  await writeFile(join(root, "src/Clean.tsx"), '<h1 className="text-4xl">x</h1>');
  const server = createMcpServer(new CommentStore(root), noopLink, undefined, {
    root,
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
  return spawnSync(process.execPath, ["--import", "tsx", CLI_ENTRY, ...args], {
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
  const result = await client.callTool({ name: "slop_scan", arguments: { paths: ["../etc"] } });
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

test("canon_read gives the reasoning and the related conflict for a rule, by id or bare id, and rejects unknown ids", async () => {
  const out = text(
    await client.callTool({ name: "canon_read", arguments: { id: "rule:NS-SLOP-GRADIENT-TEXT" } }),
  );
  assert.match(out, /NS-SLOP-GRADIENT-TEXT/);
  assert.match(out, /Conflict resolved: Gradient text/);
  const bare = text(
    await client.callTool({ name: "canon_read", arguments: { id: "ns-slop-gradient-text" } }),
  );
  assert.equal(bare, out);
  const missing = await client.callTool({
    name: "canon_read",
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
  assert.equal(cli("detect", "--root").status, 2);
});

test("the detect command reports a failed scan with a clear message and exit code 2", () => {
  const result = cli("detect", "--diff", "--root", root);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^northstar detect: git /);
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

test("the hook command reports unreadable input on stderr with a non blocking exit code", () => {
  for (const input of ["not json", ""]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_ENTRY, "hook", "post-edit"],
      { input, encoding: "utf8" },
    );
    assert.equal(result.status, 1, input);
    assert.equal(result.stdout, "", input);
    assert.match(result.stderr, /^northstar hook: /, input);
  }
  for (const input of ["{}", '{"tool_name":"Edit"}']) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_ENTRY, "hook", "post-edit"],
      { input, encoding: "utf8" },
    );
    assert.equal(result.status, 0, input);
    assert.equal(result.stdout, "", input);
    assert.equal(result.stderr, "", input);
  }
});

import { render } from "../mcp/src/cli/hook.js";
import { feedbackText, filesFor } from "../mcp/src/lib/hook-feedback.js";

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
    /Northstar found UI errors in src\/Hero\.tsx/,
  );
  assert.equal(render("cursor", "x"), "");
});

test("the hook command accepts every agent name and rejects an unknown or missing one", () => {
  const run = (...agent: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", CLI_ENTRY, "hook", "post-edit", ...agent], {
      input: "{}",
      encoding: "utf8",
    });
  for (const agent of ["claude", "codex", "gemini", "opencode", "cursor"]) {
    assert.equal(run("--agent", agent).status, 0, agent);
  }
  assert.equal(run().status, 0);
  const unknown = run("--agent", "nope");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown agent nope/);
  const missing = run("--agent");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /unknown agent \(none\)/);
  const event = spawnSync(process.execPath, ["--import", "tsx", CLI_ENTRY, "hook", "bogus"], {
    input: "{}",
    encoding: "utf8",
  });
  assert.equal(event.status, 1);
  assert.match(event.stderr, /unknown hook event bogus/);
});

import { optedIn } from "../mcp/src/lib/hook-feedback.js";

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "northstar-optin-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

const edit = (dir: string, file: string) =>
  feedbackText(
    "claude",
    { tool_name: "Edit", tool_input: { file_path: join(dir, file) }, cwd: dir },
    dir,
  );

test("the hook stays silent in a project that is not a UI project", async () => {
  const backend = await project({
    "package.json": JSON.stringify({ dependencies: { express: "5" } }),
    "src/Page.tsx": BAD,
  });
  assert.equal(edit(backend, "src/Page.tsx"), undefined);
  assert.equal(optedIn(backend, "src/Page.tsx"), false);
  const bare = await project({ "src/Page.tsx": BAD });
  assert.equal(edit(bare, "src/Page.tsx"), undefined);
  await rm(backend, { recursive: true, force: true });
  await rm(bare, { recursive: true, force: true });
});

test("a DESIGN.md or a UI dependency anywhere up the tree opts a project in", async () => {
  const designed = await project({ "DESIGN.md": "---\nname: X\n---\n", "src/Page.tsx": BAD });
  assert.match(edit(designed, "src/Page.tsx") ?? "", /NS-SLOP-GRADIENT-TEXT/);
  const mono = await project({
    "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
    "apps/web/package.json": JSON.stringify({ dependencies: { next: "15" } }),
    "apps/web/app/page.tsx": BAD,
    "apps/api/package.json": JSON.stringify({ dependencies: { express: "5" } }),
    "apps/api/src/mail.tsx": BAD,
  });
  assert.match(edit(mono, "apps/web/app/page.tsx") ?? "", /NS-SLOP-GRADIENT-TEXT/);
  assert.equal(edit(mono, "apps/api/src/mail.tsx"), undefined);
  await rm(designed, { recursive: true, force: true });
  await rm(mono, { recursive: true, force: true });
});

test("tests, fixtures and specs are never scanned by the hook", async () => {
  const dir = await project({
    "package.json": JSON.stringify({ dependencies: { react: "19" } }),
    "src/Hero.test.tsx": BAD,
    "src/Hero.spec.tsx": BAD,
    "tests/render.tsx": BAD,
    "fixtures/fail/Landing.tsx": BAD,
    "src/__tests__/a.tsx": BAD,
    "src/Hero.tsx": BAD,
  });
  for (const file of [
    "src/Hero.test.tsx",
    "src/Hero.spec.tsx",
    "tests/render.tsx",
    "fixtures/fail/Landing.tsx",
    "src/__tests__/a.tsx",
  ]) {
    assert.equal(edit(dir, file), undefined, file);
  }
  assert.match(edit(dir, "src/Hero.tsx") ?? "", /NS-SLOP-GRADIENT-TEXT/);
  await rm(dir, { recursive: true, force: true });
});

import { renderDeny } from "../mcp/src/cli/hook.js";
import { gateReason, preEditReason } from "../mcp/src/lib/hook-feedback.js";
import { designGap, readDesign } from "../mcp/src/project.js";
import { CLI_ENTRY, noopLink } from "./helpers.js";

const CLEAN = '<h1 className="text-4xl">x</h1>';
const FULL_TOKENS =
  'name: Acme\ncolors:\n  primary: "#1D4ED8"\ntypography:\n  body:\n    fontFamily: Geist\n    fontSize: 16px\nrounded:\n  md: 8px\nspacing:\n  md: 16px\n';
const READY_DESIGN = `---\n${FULL_TOKENS}northstar:\n  mode: operate\n---\n`;

const claudeEdit = (dir: string, file: string, tool = "Write") =>
  preEditReason(
    "claude",
    { tool_name: tool, tool_input: { file_path: join(dir, file) }, cwd: dir },
    dir,
  );

test("the gate blocks UI edits in a UI project until DESIGN.md is ready", async () => {
  const dir = await project({
    "package.json": JSON.stringify({ dependencies: { react: "19" } }),
    "src/Page.tsx": CLEAN,
  });
  const reason = claudeEdit(dir, "src/Page.tsx");
  assert.match(reason ?? "", /write DESIGN\.md before any UI code, there is no DESIGN\.md/);
  assert.match(reason ?? "", /design_md_normalize/);
  assert.equal(JSON.parse(renderDeny(reason ?? "")).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(JSON.parse(renderDeny("x")).hookSpecificOutput.hookEventName, "PreToolUse");

  await writeFile(join(dir, "DESIGN.md"), "---\nname: X\n---\n");
  assert.match(claudeEdit(dir, "src/Page.tsx") ?? "", /not valid yet \(colors is required/);
  await writeFile(
    join(dir, "DESIGN.md"),
    '---\nname: X\ncolors:\n  primary: "<hex>"\nnorthstar:\n  mode: operate\n---\n',
  );
  assert.match(claudeEdit(dir, "src/Page.tsx") ?? "", /unfilled placeholders/);
  await writeFile(join(dir, "DESIGN.md"), `---\n${FULL_TOKENS}---\n`);
  assert.match(designGap(readDesign(dir)) ?? "", /northstar\.mode: mode must be one of/);

  await writeFile(join(dir, "DESIGN.md"), READY_DESIGN);
  assert.equal(designGap(readDesign(dir)), undefined);
  assert.equal(claudeEdit(dir, "src/Page.tsx"), undefined);
  await rm(dir, { recursive: true, force: true });
});

test("the gate never blocks the design files, non UI code, tests or other projects", async () => {
  const ui = await project({
    "package.json": JSON.stringify({ dependencies: { react: "19" } }),
    "src/Page.tsx": CLEAN,
  });
  for (const file of [
    "DESIGN.md",
    "PRODUCT.md",
    "design/decisions.md",
    "vite.config.js",
    "src/api.ts",
    "src/Page.test.tsx",
    "tests/page.tsx",
    "package.json",
  ]) {
    assert.equal(claudeEdit(ui, file), undefined, file);
  }
  const backend = await project({
    "package.json": JSON.stringify({ dependencies: { express: "5" } }),
    "src/mail.tsx": CLEAN,
  });
  assert.equal(claudeEdit(backend, "src/mail.tsx"), undefined);
  assert.equal(claudeEdit(ui, "src/Page.tsx", "Bash"), undefined);
  assert.equal(
    preEditReason(
      "codex",
      { tool_name: "Write", tool_input: { file_path: join(ui, "src/Page.tsx") }, cwd: ui },
      ui,
    ),
    undefined,
  );
  await rm(ui, { recursive: true, force: true });
  await rm(backend, { recursive: true, force: true });
});

test("every UI source type is gated and the gate can be switched off explicitly", async () => {
  const dir = await project({ "package.json": JSON.stringify({ dependencies: { vue: "3" } }) });
  for (const file of [
    "a.vue",
    "a.svelte",
    "a.astro",
    "a.html",
    "a.css",
    "a.scss",
    "a.jsx",
    "a.tsx",
    "a.mdx",
  ]) {
    assert.ok(gateReason(dir, file), file);
  }
  process.env.NORTHSTAR_GATE = "off";
  try {
    assert.equal(gateReason(dir, "a.vue"), undefined);
  } finally {
    process.env.NORTHSTAR_GATE = undefined;
    Reflect.deleteProperty(process.env, "NORTHSTAR_GATE");
  }
  await rm(dir, { recursive: true, force: true });
});

test("the pre-edit hook command denies through stdout and stays silent when the gate is open", async () => {
  const dir = await project({
    "package.json": JSON.stringify({ dependencies: { react: "19" } }),
    "src/Page.tsx": CLEAN,
  });
  const run = (event: string, agent = "claude") =>
    spawnSync(process.execPath, ["--import", "tsx", CLI_ENTRY, "hook", event, "--agent", agent], {
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: join(dir, "src/Page.tsx") },
        cwd: dir,
      }),
      encoding: "utf8",
    });
  const denied = run("pre-edit");
  assert.equal(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(run("pre-edit", "codex").stdout, "");
  await writeFile(join(dir, "DESIGN.md"), READY_DESIGN);
  assert.equal(run("pre-edit").stdout, "");
  await rm(dir, { recursive: true, force: true });
});

test("agents without a pre edit hook are reminded after the edit instead", async () => {
  const dir = await project({
    "package.json": JSON.stringify({ dependencies: { react: "19" } }),
    "src/Page.tsx": CLEAN,
  });
  const input = {
    tool_name: "write_file",
    tool_input: { file_path: join(dir, "src/Page.tsx") },
    cwd: dir,
  };
  assert.match(feedbackText("gemini", input, dir) ?? "", /write DESIGN\.md before any UI code/);
  assert.equal(feedbackText("claude", { ...input, tool_name: "Write" }, dir), undefined);
  await writeFile(join(dir, "DESIGN.md"), READY_DESIGN);
  assert.equal(feedbackText("gemini", input, dir), undefined);
  await rm(dir, { recursive: true, force: true });
});
