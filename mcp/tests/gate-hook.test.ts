import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runScan, scanEdited } from "../src/detect.js";
import {
  feedbackText,
  filesFor,
  findProjectRoot,
  preEditReason,
} from "../src/lib/hook-feedback.js";
import { relativeTarget, resolveInside } from "../src/lib/paths.js";

const CLEAN = '<h1 className="text-4xl">x</h1>';
const BAD =
  '<h1 className="bg-gradient-to-r from-pink-500 to-orange-400 bg-clip-text text-transparent">x</h1>';

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "northstar-gate-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

const REACT = JSON.stringify({ dependencies: { react: "19" } });

test("the project root comes from the hook env var or a walk up to .git or DESIGN.md", async () => {
  const dir = await project({
    "package.json": REACT,
    ".git/HEAD": "ref",
    "apps/web/src/a.tsx": CLEAN,
  });
  assert.equal(findProjectRoot(join(dir, "apps/web/src"), {}), dir);
  assert.equal(
    findProjectRoot(join(dir, "apps/web/src"), { CLAUDE_PROJECT_DIR: "/somewhere" }),
    "/somewhere",
  );
  const designed = await project({ "DESIGN.md": "---\nname: X\n---\n", "src/deep/a.tsx": CLEAN });
  assert.equal(findProjectRoot(join(designed, "src/deep"), {}), designed);
  const bare = await project({ "package.json": REACT, "src/a.tsx": CLEAN });
  assert.equal(findProjectRoot(join(bare, "src"), {}), bare);
  await rm(dir, { recursive: true, force: true });
  await rm(designed, { recursive: true, force: true });
  await rm(bare, { recursive: true, force: true });
});

test("a sibling directory that shares the root prefix is outside the root", () => {
  assert.equal(relativeTarget("/work/app", "/work/app2/src/a.tsx"), undefined);
  assert.equal(relativeTarget("/work/app", "/work/app/src/a.tsx"), "src/a.tsx");
  assert.equal(relativeTarget("/work/app", "/work/app/..hidden/a.tsx"), "..hidden/a.tsx");
  assert.equal(relativeTarget("/work/app", "../other/a.tsx"), undefined);
});

test("windows style paths are normalised and drives are compared", () => {
  assert.equal(relativeTarget("C:\\proj", "C:\\proj\\src\\App.tsx"), "src/App.tsx");
  assert.equal(relativeTarget("C:\\proj", "c:\\PROJ\\src\\App.tsx"), "src/App.tsx");
  assert.equal(relativeTarget("C:\\proj", "D:\\proj\\src\\App.tsx"), undefined);
  assert.equal(relativeTarget("C:\\proj", "src\\App.tsx"), "src/App.tsx");
});

test("notebook edits name their file through notebook_path", () => {
  assert.deepEqual(
    filesFor("claude", { tool_name: "NotebookEdit", tool_input: { notebook_path: "a.ipynb" } }),
    ["a.ipynb"],
  );
});

test("the gate stays closed until DESIGN.md is fully ready, and says what fails", async () => {
  const dir = await project({
    "package.json": REACT,
    "DESIGN.md": '---\nname: X\ncolors:\n  primary: "#111111"\nnorthstar:\n  mode: operate\n---\n',
    "src/Page.tsx": CLEAN,
  });
  const reason = preEditReason(
    "claude",
    { tool_name: "Write", tool_input: { file_path: join(dir, "src/Page.tsx") } },
    dir,
  );
  assert.match(reason ?? "", /not valid yet \(typography is required/);
  assert.match(reason ?? "", /figma/);
  await rm(dir, { recursive: true, force: true });
});

test("an unparseable DESIGN.md keeps the gate closed and shows the parse error", async () => {
  const dir = await project({
    "package.json": REACT,
    "DESIGN.md": "no frontmatter here",
    "src/Page.tsx": CLEAN,
  });
  const reason = preEditReason(
    "claude",
    { tool_name: "Edit", tool_input: { file_path: join(dir, "src/Page.tsx") } },
    dir,
  );
  assert.match(reason ?? "", /DESIGN\.md cannot be read: DESIGN\.md has no YAML frontmatter/);
  await rm(dir, { recursive: true, force: true });
});

test("a malformed package.json is reported by the hook, not skipped", async () => {
  const dir = await project({ "package.json": "{ nope", "src/Page.tsx": CLEAN });
  assert.throws(
    () =>
      preEditReason(
        "claude",
        { tool_name: "Write", tool_input: { file_path: join(dir, "src/Page.tsx") } },
        dir,
      ),
    /package\.json is not valid JSON/,
  );
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "hook", "pre-edit"],
    {
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: join(dir, "src/Page.tsx") },
        cwd: dir,
      }),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /northstar hook: .*package\.json is not valid JSON/);
  await rm(dir, { recursive: true, force: true });
});

test("a scan failure inside the hook propagates instead of passing silently", async () => {
  const dir = await project({
    "package.json": REACT,
    "DESIGN.md": "---\n: [bad\n---\n",
    "src/Hero.tsx": BAD,
  });
  assert.throws(() =>
    feedbackText(
      "claude",
      { tool_name: "Edit", tool_input: { file_path: join(dir, "src/Hero.tsx") } },
      dir,
    ),
  );
  await rm(dir, { recursive: true, force: true });
});

test("resolveInside follows symlinks and rejects escapes", async () => {
  const dir = await project({ "src/a.tsx": CLEAN });
  const outside = await project({ "secret.tsx": CLEAN });
  await symlink(outside, join(dir, "link"));
  assert.throws(() => resolveInside(dir, "link/secret.tsx"), /outside the project root/);
  assert.throws(() => resolveInside(dir, "../x"), /outside the project root/);
  assert.equal(resolveInside(dir, "src/new-file.tsx"), "src/new-file.tsx");
  assert.equal(resolveInside(dir, "."), ".");
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("diff scanning reports a missing repository and a missing HEAD", async () => {
  const dir = await project({ "src/a.tsx": CLEAN });
  assert.throws(() => runScan({ root: dir, diff: true }), /git rev-parse failed/);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  assert.throws(() => runScan({ root: dir, diff: true }), /no commits yet/);
  await rm(dir, { recursive: true, force: true });
});

test("diff scanning is relative to a subdirectory root", async () => {
  const dir = await project({ "web/src/Hero.tsx": CLEAN, "api/x.tsx": CLEAN });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  await writeFile(join(dir, "web/src/Hero.tsx"), BAD);
  await writeFile(join(dir, "api/x.tsx"), BAD);
  const outcome = runScan({ root: join(dir, "web"), diff: true });
  assert.equal(outcome.scanned, 1);
  assert.equal(outcome.findings[0]?.file, "src/Hero.tsx");
  await rm(dir, { recursive: true, force: true });
});

test("scanEdited names the files it skipped and the scan failures", async () => {
  const dir = await project({ "src/Hero.tsx": BAD });
  const out = scanEdited(dir, ["src/Hero.tsx", "../outside.tsx"]);
  assert.match(out, /NS-SLOP-GRADIENT-TEXT/);
  assert.match(
    out,
    /Northstar did not scan:\n\.\.\/outside\.tsx: path \.\.\/outside\.tsx is outside the project root/,
  );
  await writeFile(join(dir, "DESIGN.md"), "---\n: [bad\n---\n");
  assert.match(scanEdited(dir, ["src/Hero.tsx"]), /Northstar scan failed: /);
  await rm(dir, { recursive: true, force: true });
});
