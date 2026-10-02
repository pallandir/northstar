import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const home = mkdtempSync(join(tmpdir(), "ns-ext-"));
dirs.push(home);

test("unpacked Northstar builds are found in every Chrome profile and the others are ignored", async () => {
  const { findLocalExtensionIds, chromeUserDataDir } = await import(
    "../mcp/src/install/chrome-extensions.js"
  );
  const chrome = chromeUserDataDir(home, "darwin") as string;
  const make = (profile: string, entries: Record<string, { location: number; path: string }>) => {
    mkdirSync(join(chrome, profile), { recursive: true });
    writeFileSync(
      join(chrome, profile, "Secure Preferences"),
      JSON.stringify({ extensions: { settings: entries } }),
    );
  };
  const build = (name: string) => {
    const dir = mkdtempSync(join(home, "ext-"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ name }));
    return dir;
  };
  const mine = "a".repeat(32);
  const other = "b".repeat(32);
  const store = "c".repeat(32);
  const gone = "d".repeat(32);
  make("Default", {
    [mine]: { location: 4, path: build("Northstar") },
    [other]: { location: 4, path: build("Something else") },
    [store]: { location: 1, path: build("Northstar") },
    [gone]: { location: 4, path: join(home, "missing") },
  });
  make("Profile 2", { [`${"e".repeat(31)}f`]: { location: 4, path: build("Northstar") } });
  assert.deepEqual(findLocalExtensionIds(home, "darwin"), [mine, `${"e".repeat(31)}f`]);
});
