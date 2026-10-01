import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { VERSION } from "../src/config.js";

function cli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    encoding: "utf8",
  });
}

test("--version prints the package version without starting the server", () => {
  const result = cli("--version");
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), VERSION);
});

test("an unknown command prints usage and exits 2", () => {
  const result = cli("nope");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command: nope/);
  assert.match(result.stderr, /Usage: northstar/);
});
