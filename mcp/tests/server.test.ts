import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Broker } from "../src/broker.js";
import { createMcpServer } from "../src/server.js";
import { CommentStore } from "../src/store.js";
import type { IncomingComment } from "../src/types.js";

let root: string;
let store: CommentStore;
let broker: Broker;
let client: Client;

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

function text(result: CallResult): string {
  const items = result.content as Array<{ type: string; text?: string }>;
  return items
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

function sample(overrides: Partial<IncomingComment> = {}): IncomingComment {
  return {
    comment: "Fix padding",
    operation: { type: "comment", property: null, from: null, to: null },
    operator: "/html/body/main[1]",
    url: "http://localhost:3000/",
    metadata: { page: "/", viewport: { w: 1440, h: 900 }, elementText: "hi" },
    screenshotDataUrl: null,
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-server-"));
  store = new CommentStore(root);
  broker = new Broker();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(store, broker);
  await server.connect(serverTransport);

  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("list_comments returns empty when no comments exist", async () => {
  const result = await client.callTool({ name: "list_comments", arguments: {} });
  assert.ok(text(result).includes("No comments"));
});

test("list_comments returns all comments and filters by status", async () => {
  const c = await store.add(sample());
  await store.setStatus(c.id, "resolved");
  await store.add(sample({ comment: "second open" }));

  const all = await client.callTool({ name: "list_comments", arguments: {} });
  assert.ok(text(all).includes("resolved"));
  assert.ok(text(all).includes("open"));

  const open = await client.callTool({ name: "list_comments", arguments: { status: "open" } });
  assert.ok(text(open).includes("second open"));
  assert.ok(!text(open).includes("resolved"));
});

test("resolve_comment updates a comment's status", async () => {
  const c = await store.add(sample());
  const result = await client.callTool({
    name: "resolve_comment",
    arguments: { id: c.id, status: "resolved" },
  });
  assert.ok(text(result).includes("resolved"));
  const after = await store.get(c.id);
  assert.equal(after?.status, "resolved");
});

test("resolve_comment returns not-found message for unknown id", async () => {
  const result = await client.callTool({
    name: "resolve_comment",
    arguments: { id: "no-such-id", status: "resolved" },
  });
  assert.ok(text(result).includes("no-such-id"));
});

test("resolve_comments resolves a batch of comments", async () => {
  const a = await store.add(sample());
  const b = await store.add(sample({ comment: "second" }));
  const result = await client.callTool({
    name: "resolve_comments",
    arguments: {
      resolutions: [
        { id: a.id, status: "resolved" },
        { id: b.id, status: "wontfix" },
      ],
    },
  });
  const output = text(result);
  assert.ok(output.includes("resolved"));
  assert.ok(output.includes("wontfix"));
  assert.equal((await store.list("open")).length, 0);
});

test("defer_comment parks a comment and creates a deferred entry", async () => {
  const c = await store.add(sample());
  const result = await client.callTool({
    name: "defer_comment",
    arguments: { id: c.id, reason: "needs architecture decision" },
  });
  assert.ok(text(result).includes("deferred"));
  const deferred = await store.listDeferred();
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].id, c.id);
  const after = await store.get(c.id);
  assert.equal(after?.status, "wontfix");
});

test("defer_comment returns not-found message for unknown id", async () => {
  const result = await client.callTool({
    name: "defer_comment",
    arguments: { id: "no-such-id", reason: "planning" },
  });
  assert.ok(text(result).includes("no-such-id"));
});

test("list_deferred returns deferred entries after deferring", async () => {
  const empty = await client.callTool({ name: "list_deferred", arguments: {} });
  assert.ok(text(empty).includes("No deferred"));

  const c = await store.add(sample({ comment: "complex task" }));
  await client.callTool({
    name: "defer_comment",
    arguments: { id: c.id, reason: "too complex" },
  });
  const result = await client.callTool({ name: "list_deferred", arguments: {} });
  assert.ok(text(result).includes("complex task"));
  assert.ok(text(result).includes("too complex"));
});

test("clear_resolved removes non-open comments and reports the count", async () => {
  const a = await store.add(sample());
  const b = await store.add(sample({ comment: "second" }));
  await store.setStatus(a.id, "resolved");
  await store.setStatus(b.id, "wontfix");
  await store.add(sample({ comment: "still open" }));

  const result = await client.callTool({ name: "clear_resolved", arguments: {} });
  assert.ok(text(result).includes("2"));
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.list())[0].comment, "still open");
});

test("the server exposes exactly the six comment tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "clear_resolved",
    "defer_comment",
    "list_comments",
    "list_deferred",
    "resolve_comment",
    "resolve_comments",
  ]);
});

test("the watch prompt is gone", async () => {
  await assert.rejects(() => client.listPrompts());
});
