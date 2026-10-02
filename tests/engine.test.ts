import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp/src/server.js";
import { CommentStore } from "../mcp/src/store.js";
import { noopLink } from "./helpers.js";

let root: string;
let client: Client;

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

const text = (result: CallResult) =>
  (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");

const call = (name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-engine-"));
  const server = createMcpServer(new CommentStore(root), noopLink, undefined, {
    root,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("canon_find returns ids with costs inside a small budget", async () => {
  const out = text(await call("canon_find", { query: "button has no pressed feedback" }));
  assert.match(out, /rule:NS-FINISH-PRESS-STATE/);
  assert.match(out, /~\d+t/);
  assert.ok(out.length < 2400, `result is ${out.length} characters`);
});

test("canon_find says what to try when nothing matches", async () => {
  const out = text(await call("canon_find", { query: "zzzqqq xxyyzz" }));
  assert.match(out, /No match/);
  assert.match(out, /topic:/);
});

test("canon_read returns an outline for a topic, a section on request and a fix for a bad id", async () => {
  const outline = text(await call("canon_read", { id: "ref:polish" }));
  assert.match(outline, /Sections, read one at a time/);
  const section = /ref:polish#[a-z0-9-]+/.exec(outline)?.[0];
  assert.ok(section);
  const body = text(await call("canon_read", { id: section }));
  assert.ok(body.length < outline.length * 6);
  const whole = text(await call("canon_read", { id: "ref:polish", full: true }));
  assert.match(whole, /^# Polish/);
  const bad = await call("canon_read", { id: "ref:polish#nope" });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /Did you mean/);
});

test("slop_scan with inventory counts the mess, lists drift and orders the levers", async () => {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src", "a.css"),
    ".a{color:#1e40af;border-radius:3px;box-shadow:0 2px 4px rgba(0,0,0,.2);min-height:100vh}.a:hover{opacity:.9}.button:hover{opacity:.9}",
  );
  const out = text(await call("slop_scan", { inventory: true }));
  assert.match(out, /Inventory of 1 files/);
  assert.match(out, /colors: \d+ distinct/);
  assert.match(out, /Levers in order:/);
});

test("slop_scan with inventory fails clearly when there is no UI to read", async () => {
  const result = await call("slop_scan", { inventory: true });
  assert.equal(result.isError, true);
  assert.match(text(result), /No UI files found/);
});

test("the canon index is a small resource", async () => {
  const { contents } = await client.readResource({ uri: "northstar://canon/index" });
  const body = (contents[0] as { text: string }).text;
  assert.match(body, /canon_find/);
  assert.ok(body.length / 4 < 2500);
});
