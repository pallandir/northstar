import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { projectRoot } from "../mcp/src/lib/paths.js";

let base: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "ns-root-")));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function dir(...parts: string[]): string {
  const path = join(base, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
}

test("a folder inside a git repository resolves to the repository root", () => {
  dir(".git");
  assert.equal(projectRoot(dir("packages", "web", "src"), {}), base);
});

test("the nearest DESIGN.md marks the project before an outer repository does", () => {
  dir(".git");
  writeFileSync(join(dir("apps", "web"), "DESIGN.md"), "x");
  assert.equal(projectRoot(dir("apps", "web", "src"), {}), join(base, "apps", "web"));
});

test("without a repository the nearest package.json marks the project", () => {
  writeFileSync(join(dir("app"), "package.json"), "{}");
  assert.equal(projectRoot(dir("app", "src"), {}), join(base, "app"));
});

test("a folder with no marker is its own project", () => {
  assert.equal(projectRoot(dir("bare"), {}), join(base, "bare"));
});

test("NORTHSTAR_ROOT wins over the folder, and a missing one is an error", () => {
  dir(".git");
  const other = dir("other");
  assert.equal(projectRoot(dir("packages"), { NORTHSTAR_ROOT: other }), other);
  assert.throws(() => projectRoot(base, { NORTHSTAR_ROOT: join(base, "gone") }), /ENOENT/);
});

test("a marker in the home folder never makes the home folder the project", () => {
  const home = dir("home");
  mkdirSync(join(home, ".git"));
  writeFileSync(join(home, "package.json"), "{}");
  const work = dir("home", "work", "site");
  assert.equal(projectRoot(work, {}, home), work);
  assert.equal(projectRoot(home, {}, home), home);
});

test("a repository below the home folder is still found", () => {
  const home = dir("home");
  mkdirSync(join(home, ".git"));
  dir("home", "work", ".git");
  assert.equal(projectRoot(dir("home", "work", "site", "src"), {}, home), join(home, "work"));
});
