import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Registry } from "../mcp/src/daemon/registry.js";
import { stateDir } from "../mcp/src/lib/home.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ns-registry-"));
});

afterEach(() => {
  chmodSync(home, 0o700);
  rmSync(home, { recursive: true, force: true });
});

test("a corrupt projects.json stops the registry with the file and the fix", () => {
  mkdirSync(stateDir(home), { recursive: true });
  writeFileSync(join(stateDir(home), "projects.json"), "{ not json");
  assert.throws(() => new Registry(home), /projects\.json.*delete/is);
});

test("a root that cannot be saved is reported and not silently dropped", () => {
  const registry = new Registry(home);
  mkdirSync(stateDir(home), { recursive: true });
  chmodSync(stateDir(home), 0o500);
  try {
    assert.throws(() => registry.rememberRoot(home), /could not save/i);
  } finally {
    chmodSync(stateDir(home), 0o700);
  }
});
