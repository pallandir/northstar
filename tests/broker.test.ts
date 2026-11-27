import assert from "node:assert/strict";
import { test } from "node:test";
import { Broker } from "../mcp/src/daemon/broker.js";

function notice(id: string) {
  return { commentId: id, page: "/", summary: "s", createdAt: new Date().toISOString() };
}

test("version starts at 1 and advances on bump", () => {
  const broker = new Broker();
  assert.equal(broker.currentVersion, 1);
  broker.bump();
  assert.equal(broker.currentVersion, 2);
});

test("markPolled records when the agent last read the store", () => {
  const broker = new Broker();
  assert.equal(broker.lastPolledAt, null);
  broker.markPolled();
  assert.equal(typeof broker.lastPolledAt, "string");
});

test("pushNotice queues a notice and bumps the version", () => {
  const broker = new Broker();
  const before = broker.currentVersion;
  broker.pushNotice(notice("c1"));
  assert.equal(broker.pendingNotices.length, 1);
  assert.ok(broker.currentVersion > before);
});

test("notices are newest first and capped at 20", () => {
  const broker = new Broker();
  for (let i = 0; i < 25; i += 1) broker.pushNotice(notice(`c${i}`));
  assert.equal(broker.pendingNotices.length, 20);
  assert.equal(broker.pendingNotices[0].commentId, "c24");
});

test("dismissNotice removes only the matching notice", () => {
  const broker = new Broker();
  broker.pushNotice(notice("c1"));
  broker.pushNotice(notice("c2"));
  broker.dismissNotice("c1");
  assert.deepEqual(
    broker.pendingNotices.map((n) => n.commentId),
    ["c2"],
  );
});

test("pendingNotices hands out a copy, not the live array", () => {
  const broker = new Broker();
  broker.pushNotice(notice("c1"));
  broker.pendingNotices.pop();
  assert.equal(broker.pendingNotices.length, 1);
});

test("the last handoff outcome is remembered", () => {
  const broker = new Broker();
  assert.equal(broker.lastHandoff === null, true);
  broker.recordHandoff({ delivered: true, at: "now" });
  assert.equal(broker.lastHandoff?.delivered, true);
});

test("a listen whose connection already closed leaves no waiter and the handoff stays queued", async () => {
  const broker = new Broker();
  const closed = new AbortController();
  closed.abort();
  const settled = await Promise.race([
    broker.listen(5_000, closed.signal),
    new Promise((resolve) => setTimeout(() => resolve("still waiting"), 200)),
  ]);
  assert.deepEqual(settled, { template: null });
  assert.equal(broker.listening, false);
  assert.equal(broker.signalHandoff("resolve"), false);
  assert.deepEqual(await broker.listen(5_000, new AbortController().signal), {
    template: "resolve",
  });
});

test("an already closed listen does not take a queued handoff away from the next one", async () => {
  const broker = new Broker();
  assert.equal(broker.signalHandoff("fix"), false);
  const closed = new AbortController();
  closed.abort();
  assert.deepEqual(await broker.listen(5_000, closed.signal), { template: null });
  assert.deepEqual(await broker.listen(5_000, new AbortController().signal), { template: "fix" });
});
