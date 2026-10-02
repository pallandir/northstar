import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { CommentStore } from "../mcp/src/store.js";
import type { Draft } from "../mcp/src/types.js";
import { draft } from "./helpers.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-store-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sample(overrides: Partial<Draft> = {}): Draft {
  return draft({
    comment: "This card padding is off",
    operator: "/html/body/main[1]/section[2]/div[1]",
    url: "http://localhost:3000/dashboard",
    metadata: { page: "/dashboard", viewport: { w: 1440, h: 900 }, elementText: "Total revenue" },
    source: { path: "src/Card.tsx", line: 42, column: 8, via: "react-dev-inspector" },
    screenshotDataUrl: null,
    ...overrides,
  });
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

test("resolving stores by, note, files and a timestamp", async () => {
  const store = new CommentStore(root);
  const a = await store.add(sample());
  await store.setStatus(a.id, "resolved", { note: "fixed", files: ["src/Card.tsx"] });
  const got = await store.get(a.id);
  assert.equal(got?.resolution?.by, "agent");
  assert.equal(got?.resolution?.note, "fixed");
  assert.deepEqual(got?.resolution?.files, ["src/Card.tsx"]);
  assert.ok(got?.resolution?.at);

  await store.reopenWithNote(a.id);
  assert.equal((await store.get(a.id))?.resolution, undefined);
});

test("claim moves open to in_progress once and clearResolved keeps it", async () => {
  const store = new CommentStore(root);
  const a = await store.add(sample());
  assert.equal((await store.claim(a.id))?.claimed, true);
  assert.equal((await store.claim(a.id))?.claimed, false);
  assert.equal(await store.clearResolved(), 0);
  assert.equal((await store.get(a.id))?.status, "in_progress");
});

test("a repeated cid returns the stored comment without duplicating it", async () => {
  const store = new CommentStore(root);
  const first = await store.ingest(sample({ cid: "k1" }));
  const second = await store.ingest(sample({ cid: "k1" }));
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.comment.id, first.comment.id);
  assert.equal((await store.list()).length, 1);
});

const PNG = "data:image/png;base64,iVBORw0KGgo=";

test("clearing comments deletes their screenshot files", async () => {
  const store = new CommentStore(root);
  const a = await store.add(sample({ screenshotDataUrl: PNG }));
  const b = await store.add(sample({ screenshotDataUrl: PNG }));
  assert.ok(a.screenshot && b.screenshot);
  await store.setStatus(a.id, "resolved");
  await store.clearResolved();
  assert.equal(await exists(join(root, a.screenshot)), false);
  assert.equal(await exists(join(root, b.screenshot)), true);

  await store.clear();
  assert.equal(await exists(join(root, b.screenshot)), false);
});

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

test("a corrupt comments file stops the store with an error that names the file and a backup", async () => {
  const store = new CommentStore(root);
  await store.add(sample());
  await writeFile(store.commentsPath, "{ not json", "utf8");

  await assert.rejects(store.list(), (error: Error) => {
    assert.ok(error.message.includes(store.commentsPath));
    assert.match(error.message, /\.bak-/);
    assert.match(error.message, /Fix the file or delete it/);
    return true;
  });
  await assert.rejects(store.add(sample()), /corrupt/);
  const files = await readdir(dirname(store.commentsPath));
  const backups = files.filter((f) => f.startsWith("design-comments.json.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(
    await readFile(join(dirname(store.commentsPath), backups[0] as string), "utf8"),
    "{ not json",
  );
  assert.equal(await readFile(store.commentsPath, "utf8"), "{ not json");
});

test("a store that is valid JSON but not a comment list is corrupt", async () => {
  const store = new CommentStore(root);
  await store.add(sample());
  await writeFile(store.commentsPath, JSON.stringify([{ nope: true }]), "utf8");
  await assert.rejects(store.list(), /corrupt/);
});

test("the markdown mirror is never read back", async () => {
  const store = new CommentStore(root);
  await store.add(sample());
  await rm(store.commentsPath);
  assert.deepEqual(await store.list(), []);
});

test("the screenshot extension follows the mime type and the write is atomic", async () => {
  const store = new CommentStore(root);
  const jpeg = await store.add(sample({ screenshotDataUrl: "data:image/jpeg;base64,/9j/4AAQ" }));
  const webp = await store.add(sample({ screenshotDataUrl: "data:image/webp;base64,UklGRg==" }));
  assert.match(jpeg.screenshot ?? "", /\.jpg$/);
  assert.match(webp.screenshot ?? "", /\.webp$/);
  const files = await readdir(join(root, ".northstar", "design-shots"));
  assert.equal(files.filter((f) => f.endsWith(".tmp")).length, 0);
});

test("ingestMany writes a batch once and dedupes a cid repeated inside it", async () => {
  const store = new CommentStore(root);
  const same = sample({ cid: "same" });
  const outcomes = await store.ingestMany([sample(), same, same]);
  assert.deepEqual(
    outcomes.map((o) => o.ok && o.duplicate),
    [false, false, true],
  );
  assert.equal((await store.list()).length, 2);
});

test("a failed batch leaves no screenshot behind", async () => {
  const store = new CommentStore(root);
  await store.add(sample());
  await writeFile(store.commentsPath, "{ not json", "utf8");
  await assert.rejects(store.ingestMany([sample({ screenshotDataUrl: PNG })]));
  const shots = await readdir(join(root, ".northstar", "design-shots")).catch(() => []);
  assert.equal(shots.length, 0);
});

test("list is served from the cache until the file changes", async () => {
  const store = new CommentStore(root);
  await store.add(sample({ comment: "first" }));
  const a = await store.list();
  const b = await store.list();
  assert.equal(a[0], b[0]);

  const other = new CommentStore(root);
  await other.add(sample({ comment: "second" }));
  assert.equal((await store.list()).length, 2);
});

test("clear and list filter by page key, ignoring query and trailing slash", async () => {
  const store = new CommentStore(root);
  await store.add(sample({ url: "http://localhost:3000/users/1?tab=a" }));
  await store.add(sample({ url: "http://localhost:3000/users/1/" }));
  await store.add(sample({ url: "http://localhost:3000/users/2" }));
  assert.equal((await store.list(undefined, "http://localhost:3000/users/1")).length, 2);
  assert.equal(await store.clear("http://localhost:3000/users/1"), 2);
  assert.equal((await store.list()).length, 1);
  assert.equal(await store.clear("http://localhost:3000/nothing"), 0);
});

test("update reports a no-op and reopen reports an already open comment", async () => {
  const store = new CommentStore(root);
  const a = await store.add(sample());
  assert.equal((await store.update(a.id, "open"))?.changed, false);
  assert.equal((await store.update(a.id, "resolved", { note: "x" }))?.changed, true);
  assert.equal((await store.update(a.id, "resolved", { note: "x" }))?.changed, false);
  assert.equal((await store.reopenWithNote(a.id))?.changed, true);
  assert.equal((await store.reopenWithNote(a.id))?.changed, false);
  assert.equal(await store.update("missing", "open"), undefined);
});

test("deferred entries are stored as JSON and a corrupt file stops with an error", async () => {
  const store = new CommentStore(root);
  const c = await store.add(sample());
  const entry = await store.addDeferred(c, "too big", "assistant", "needs-plan");
  assert.equal(entry.reason, "too big");
  assert.deepEqual(JSON.parse(await readFile(store.deferredFile, "utf8"))[0].id, c.id);
  assert.equal((await store.addDeferred(c, "again", "user")).reason, "too big");
  assert.equal((await new CommentStore(root).listDeferred()).length, 1);

  await writeFile(store.deferredFile, "oops", "utf8");
  await assert.rejects(new CommentStore(root).listDeferred(), /corrupt/);
});

test("two stores on one root serialise writes through the file lock", async () => {
  const a = new CommentStore(root);
  const b = new CommentStore(root);
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).add(sample({ comment: `c${i}` }))),
  );
  assert.equal((await new CommentStore(root).list()).length, 12);
});

test("a stale lock is taken over", async () => {
  const store = new CommentStore(root);
  await store.add(sample());
  const lock = join(root, ".northstar", "store.lock");
  await mkdir(lock);
  const old = new Date(Date.now() - 120_000);
  await utimes(lock, old, old);
  await store.add(sample());
  assert.equal((await store.list()).length, 2);
  await assert.rejects(stat(lock), /ENOENT/);
});

test("the store directory gets one gitignore that is not appended to", async () => {
  const store = new CommentStore(root);
  await store.add(sample());
  await new CommentStore(root).add(sample());
  assert.equal(await readFile(join(root, ".northstar", ".gitignore"), "utf8"), "*\n");
});

function withSource(path: string) {
  return sample({ source: { path, line: 1, column: 0, via: "react-fiber" } });
}

test("source paths are confined to the project root", async () => {
  const store = new CommentStore(root);
  const relative = await store.add(withSource("src/Card.tsx"));
  assert.equal(relative.source?.path, "src/Card.tsx");
  const absolute = await store.add(withSource(join(root, "src", "Card.tsx")));
  assert.equal(absolute.source?.path, "src/Card.tsx");

  for (const bad of [
    "/etc/passwd",
    `${root}-evil/src/a.tsx`,
    "../outside.tsx",
    "src/../../outside.tsx",
  ]) {
    const [outcome] = await store.ingestMany([withSource(bad)]);
    assert.equal(outcome?.ok, false, bad);
    if (outcome && !outcome.ok) {
      assert.equal(outcome.rejection.field, "source.path");
      assert.match(outcome.rejection.error, /outside the project/);
    }
  }
  assert.equal((await store.list()).length, 2);
});

test("a symlink that leaves the project is rejected", async () => {
  const outside = await mkdtemp(join(tmpdir(), "northstar-outside-"));
  await symlink(outside, join(root, "linked"));
  const store = new CommentStore(root);
  const [outcome] = await store.ingestMany([withSource("linked/secret.tsx")]);
  assert.equal(outcome?.ok, false);
  await rm(outside, { recursive: true, force: true });
});

test("two store instances on one root, as the daemon and an MCP server are, see each other's writes", async () => {
  const daemon = new CommentStore(root);
  const server = new CommentStore(root);

  const added = await daemon.add(sample({ comment: "added by the daemon" }));
  assert.equal((await server.list("open")).length, 1);

  const claimed = await server.claim(added.id);
  assert.equal(claimed?.claimed, true);
  assert.equal((await daemon.list("in_progress")).length, 1);
  assert.equal((await daemon.list("open")).length, 0);

  await server.update(added.id, "resolved", { note: "done", files: ["src/Card.tsx"] });
  const seen = await daemon.get(added.id);
  assert.equal(seen?.status, "resolved");
  assert.equal(seen?.resolution?.note, "done");

  const both = await Promise.all([
    daemon.add(sample({ comment: "concurrent one" })),
    server.add(sample({ comment: "concurrent two" })),
  ]);
  assert.notEqual(both[0].id, both[1].id);
  assert.equal((await daemon.list()).length, 3);
  assert.equal((await server.list()).length, 3);
});
