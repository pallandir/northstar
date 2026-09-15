import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { CommentStore } from "../src/store.js";
import type { IncomingComment } from "../src/types.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-store-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sample(overrides: Partial<IncomingComment> = {}): IncomingComment {
  return {
    comment: "This card padding is off",
    operation: { type: "comment", property: null, from: null, to: null },
    operator: "/html/body/main[1]/section[2]/div[1]",
    url: "http://localhost:3000/dashboard",
    metadata: { page: "/dashboard", viewport: { w: 1440, h: 900 }, elementText: "Total revenue" },
    source: { path: "src/Card.tsx", line: 42, column: 8, via: "react-dev-inspector" },
    screenshotDataUrl: null,
    ...overrides,
  };
}

test("add then list round-trips core fields", async () => {
  const store = new CommentStore(root);
  const added = await store.add(sample());
  const [got] = await store.list();

  assert.equal(got.id, added.id);
  assert.equal(got.comment, "This card padding is off");
  assert.equal(got.metadata.page, "/dashboard");
  assert.equal(got.operation.type, "comment");
  assert.equal(got.status, "open");
  assert.equal(got.source?.path, "src/Card.tsx");
  assert.equal(got.source?.line, 42);
  assert.equal(got.operator, "/html/body/main[1]/section[2]/div[1]");
  assert.equal(got.metadata.viewport.w, 1440);
});

test("setStatus persists and list filters by status", async () => {
  const store = new CommentStore(root);
  const a = await store.add(sample());
  await store.add(sample({ comment: "second" }));

  await store.setStatus(a.id, "resolved");
  assert.equal((await store.list("open")).length, 1);
  assert.equal((await store.list("resolved")).length, 1);
});

test("clearResolved keeps only open comments", async () => {
  const store = new CommentStore(root);
  const a = await store.add(sample());
  await store.add(sample({ comment: "second" }));
  await store.setStatus(a.id, "wontfix");

  const removed = await store.clearResolved();
  assert.equal(removed, 1);
  const left = await store.list();
  assert.equal(left.length, 1);
  assert.equal(left[0].status, "open");
});

test("style operation survives a serialize/parse cycle", async () => {
  const store = new CommentStore(root);
  await store.add(
    sample({
      comment: "Change color",
      operation: { type: "style", property: "color", from: "rgb(0,0,0)", to: "#d97757" },
    }),
  );
  const [got] = await store.list();
  assert.equal(got.operation.type, "style");
  assert.equal(got.operation.property, "color");
  assert.equal(got.operation.to, "#d97757");
});

test("text operation survives a serialize/parse cycle", async () => {
  const store = new CommentStore(root);
  await store.add(
    sample({
      comment: 'Change text from "Submit" to "Save changes"',
      operation: { type: "text", property: null, from: "Submit", to: "Save changes" },
    }),
  );
  const [got] = await store.list();
  assert.equal(got.operation.type, "text");
  assert.equal(got.operation.from, "Submit");
  assert.equal(got.operation.to, "Save changes");
});

test("multi-line comment body round-trips intact", async () => {
  const multiLine = "Line one\nLine two\nLine three";
  const store = new CommentStore(root);
  await store.add(sample({ comment: multiLine }));
  const [got] = await store.list();
  assert.equal(got.comment, multiLine);
});

test("comment with middot in page name round-trips intact", async () => {
  const store = new CommentStore(root);
  await store.add(
    sample({ metadata: { page: "A · B · C", viewport: { w: 1440, h: 900 }, elementText: "hi" } }),
  );
  const [got] = await store.list();
  assert.equal(got.metadata.page, "A · B · C");
});

test("text operation containing the arrow sequence round-trips intact", async () => {
  const store = new CommentStore(root);
  await store.add(
    sample({
      operation: {
        type: "text",
        property: null,
        from: 'before " -> " after',
        to: 'end " -> " done',
      },
    }),
  );
  const [got] = await store.list();
  assert.equal(got.operation.from, 'before " -> " after');
  assert.equal(got.operation.to, 'end " -> " done');
});

test("style operation with arrow-sequence values round-trips intact", async () => {
  const store = new CommentStore(root);
  await store.add(
    sample({
      operation: {
        type: "style",
        property: "content",
        from: '"a -> b"',
        to: '"c -> d"',
      },
    }),
  );
  const [got] = await store.list();
  assert.equal(got.operation.property, "content");
  assert.equal(got.operation.from, '"a -> b"');
  assert.equal(got.operation.to, '"c -> d"');
});
