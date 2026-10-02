import assert from "node:assert/strict";
import { test } from "node:test";
import { type Draft, checkDraft } from "../protocol/src/index.js";

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cid: "cid-1",
    comment: "Make it bigger",
    operation: { type: "comment", property: null, from: null, to: null },
    operator: "/html/body/div",
    url: "http://localhost:3000/users/1",
    metadata: { page: "/users/1", viewport: { w: 1280, h: 800 }, elementText: "Hi" },
    ...overrides,
  };
}

function rejected(overrides: Record<string, unknown>) {
  const result = checkDraft(draft(overrides), 0);
  assert.equal(result.draft, undefined, "expected a rejection");
  return result.rejection;
}

test("a complete draft is accepted unchanged", () => {
  const result = checkDraft(draft(), 3);
  assert.equal(result.index, 3);
  assert.equal(result.cid, "cid-1");
  assert.equal((result.draft as Draft).comment, "Make it bigger");
});

test("a missing cid is rejected naming the field", () => {
  const { cid: _cid, ...rest } = draft();
  const result = checkDraft(rest, 0);
  assert.equal(result.rejection?.field, "cid");
  assert.match(result.rejection?.error ?? "", /cid field is required/);
  assert.ok(result.rejection?.fix);
});

test("an overlong comment is rejected, not clipped", () => {
  const r = rejected({ comment: "x".repeat(8_001) });
  assert.equal(r?.field, "comment");
  assert.match(r?.error ?? "", /at most 8000 characters/);
});

test("unknown keys are rejected", () => {
  const r = rejected({ extra: 1 });
  assert.match(r?.error ?? "", /unknown keys extra/);
});

test("non finite numbers are rejected, not zeroed", () => {
  const r = rejected({
    metadata: { page: "/", viewport: { w: Number.POSITIVE_INFINITY, h: 1 }, elementText: "" },
  });
  assert.equal(r?.field, "metadata.viewport.w");
});

test("a newline in a locate value is rejected", () => {
  const r = rejected({ locate: [{ kind: "text", value: "a\nb", confidence: "high" }] });
  assert.equal(r?.field, "locate.0.value");
  assert.match(r?.error ?? "", /single line/);
});

test("a url that is not http is rejected", () => {
  assert.equal(rejected({ url: "javascript:alert(1)" })?.field, "url");
  assert.equal(rejected({ url: "nope" })?.field, "url");
});

test("a traversal source path is rejected with the field", () => {
  const r = rejected({ source: { path: "../secret.ts", line: 1, column: 1, via: "x" } });
  assert.equal(r?.field, "source.path");
  assert.match(r?.error ?? "", /must not contain \.\./);
});

test("a screenshot that is not a data url is rejected", () => {
  assert.equal(rejected({ screenshotDataUrl: "http://x/y.png" })?.field, "screenshotDataUrl");
});

test("a non object item is rejected without a cid", () => {
  const result = checkDraft("nope", 0);
  assert.equal(result.cid, null);
  assert.ok(result.rejection);
});
