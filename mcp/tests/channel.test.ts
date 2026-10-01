import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Broker } from "../src/broker.js";
import { CHANNEL_METHOD, ChannelHandoff } from "../src/channel.js";
import { CommentStore } from "../src/store.js";
import type { Handoff, HandoffResult, TerminalStatus } from "../src/terminal/index.js";
import type { IncomingComment } from "../src/types.js";

let root: string;
let store: CommentStore;
let broker: Broker;

class FakeTerminal implements Handoff {
  sends = 0;
  async describe(): Promise<TerminalStatus> {
    return { available: true, driver: "tmux" };
  }
  async send(): Promise<HandoffResult> {
    this.sends += 1;
    return { typed: true, driver: "tmux" };
  }
}

function fakeServer(clientName: string, experimental?: Record<string, unknown>) {
  const pushed: Array<{ method: string; params: { content: string; meta: { count: string } } }> =
    [];
  return {
    pushed,
    server: {
      notification: async (n: unknown) => {
        pushed.push(n as (typeof pushed)[number]);
      },
      getClientCapabilities: () => (experimental ? { experimental } : {}),
      getClientVersion: () => ({ name: clientName, version: "1.0.0" }),
    },
  };
}

function sample(): IncomingComment {
  return {
    comment: "Fix padding",
    operation: { type: "comment", property: null, from: null, to: null },
    operator: "/html/body/main[1]",
    url: "http://localhost:3000/",
    metadata: { page: "/", viewport: { w: 1440, h: 900 }, elementText: "hi" },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-channel-"));
  store = new CommentStore(root);
  broker = new Broker();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function handoffFor(fake: ReturnType<typeof fakeServer>, terminal: FakeTerminal) {
  return new ChannelHandoff({
    server: fake.server as never,
    store,
    broker,
    terminal,
    log: () => {},
    fallbackMs: 60,
  });
}

test("a Claude Code client gets a channel push and no typing when it answers in time", async () => {
  await store.add(sample());
  const fake = fakeServer("claude-code");
  const terminal = new FakeTerminal();
  const result = await handoffFor(fake, terminal).send();

  assert.equal(result.channel, true);
  assert.equal(fake.pushed.length, 1);
  assert.equal(fake.pushed[0].method, CHANNEL_METHOD);
  assert.equal(fake.pushed[0].params.meta.count, "1");
  assert.ok(fake.pushed[0].params.content.includes("get_comment"));

  broker.markPolled();
  await wait(120);
  assert.equal(terminal.sends, 0);
});

test("silence after the push falls back to the terminal exactly once", async () => {
  await store.add(sample());
  const fake = fakeServer("claude-code");
  const terminal = new FakeTerminal();
  await handoffFor(fake, terminal).send();
  await wait(150);
  assert.equal(terminal.sends, 1);
});

test("the fallback stays quiet when the comments were already claimed", async () => {
  const c = await store.add(sample());
  const fake = fakeServer("claude-code");
  const terminal = new FakeTerminal();
  await handoffFor(fake, terminal).send();
  await store.claim(c.id);
  await wait(150);
  assert.equal(terminal.sends, 0);
});

test("a second batch before the agent answers folds into the push already sent", async () => {
  await store.add(sample());
  const fake = fakeServer("claude-code");
  const handoff = handoffFor(fake, new FakeTerminal());
  await handoff.send();
  await store.add(sample());
  await handoff.send();
  assert.equal(fake.pushed.length, 1);
});

test("a client without channel support goes straight to the terminal", async () => {
  await store.add(sample());
  const fake = fakeServer("codex");
  const terminal = new FakeTerminal();
  const result = await handoffFor(fake, terminal).send();
  assert.equal(result.typed, true);
  assert.equal(fake.pushed.length, 0);
  assert.equal(terminal.sends, 1);
});

test("a client advertising the capability is pushed to", async () => {
  await store.add(sample());
  const fake = fakeServer("other-client", { "claude/channel": {} });
  await handoffFor(fake, new FakeTerminal()).send();
  assert.equal(fake.pushed.length, 1);
});

test("nothing open means nothing is sent", async () => {
  const fake = fakeServer("claude-code");
  const terminal = new FakeTerminal();
  const result = await handoffFor(fake, terminal).send();
  assert.equal(result.typed, false);
  assert.equal(fake.pushed.length, 0);
  assert.equal(terminal.sends, 0);
});
