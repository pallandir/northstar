import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSafeSourcePath, sanitizeSourcePath } from "../protocol/src/index.js";

test("relative paths pass", () => {
  assertSafeSourcePath("src/App.tsx");
  assertSafeSourcePath("src/~tmp/App.tsx");
  assertSafeSourcePath("/Users/me/app/src/App.tsx");
  assertSafeSourcePath("C:\\work\\app\\src\\App.tsx");
});

test("traversal, control characters and leading tilde paths are rejected", () => {
  for (const bad of ["../a.ts", "src/../../a.ts", "a\\..\\b.ts", "~/a.ts", "", "a\u0000b"]) {
    assert.throws(() => assertSafeSourcePath(bad));
  }
});

test("an absolute path inside the root becomes relative", () => {
  assert.equal(sanitizeSourcePath("/Users/me/app/src/App.tsx", "/Users/me/app"), "src/App.tsx");
  assert.equal(sanitizeSourcePath("/Users/me/app/src/App.tsx", "/Users/me/app/"), "src/App.tsx");
  assert.equal(sanitizeSourcePath("C:\\work\\app\\src\\App.tsx", "c:/work/app"), "src/App.tsx");
});

test("url style prefixes are stripped", () => {
  assert.equal(
    sanitizeSourcePath("file:///Users/me/app/src/My%20App.tsx", "/Users/me/app"),
    "src/My App.tsx",
  );
  assert.equal(sanitizeSourcePath("webpack://app/./src/App.tsx", "/Users/me/app"), "src/App.tsx");
  assert.equal(sanitizeSourcePath("/@fs/Users/me/app/src/App.tsx", "/Users/me/app"), "src/App.tsx");
});

test("paths outside the root are rejected", () => {
  assert.throws(() => sanitizeSourcePath("/Users/me/other/a.ts", "/Users/me/app"));
  assert.throws(() => sanitizeSourcePath("/Users/me/app/../other/a.ts", "/Users/me/app"));
  assert.throws(() => sanitizeSourcePath("/Users/me/appx/a.ts", "/Users/me/app"));
});

test("dot segments are normalised", () => {
  assert.equal(sanitizeSourcePath("./src//App.tsx", "/r"), "src/App.tsx");
});

test("a root with a very long run of trailing slashes is trimmed in linear time", () => {
  const root = `/proj${"/".repeat(200_000)}`;
  const started = Date.now();
  assert.equal(sanitizeSourcePath("/proj/src/App.tsx", root), "src/App.tsx");
  assert.ok(Date.now() - started < 1_000);
});
