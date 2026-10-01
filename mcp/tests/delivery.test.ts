import assert from "node:assert/strict";
import { test } from "node:test";
import { Broker } from "../src/broker.js";
import { AgentDelivery, CHANNEL_METHOD, listensToNorthstar } from "../src/delivery.js";
import type { AgentProcess } from "../src/terminal/discover.js";
import type { TerminalCheck, TerminalTyper, TypeResult } from "../src/terminal/index.js";

class FakeTerminal {
  types = 0;
  check_: TerminalCheck = { ok: true, driver: "tmux" };
  typeResult: TypeResult = { typed: true };
  onType: () => void = () => {};

  async check(): Promise<TerminalCheck> {
    return this.check_;
  }

  async type(): Promise<TypeResult> {
    this.types += 1;
    this.onType();
    return this.typeResult;
  }
}

const CLAUDE_WITH_CHANNEL = "claude --dangerously-load-development-channels server:northstar";

function build(agent: AgentProcess, pickupMs = 60) {
  const broker = new Broker();
  const terminal = new FakeTerminal();
  const pushes: { method: string; params: { content: string; meta: unknown } }[] = [];
  let failPush: Error | null = null;
  const delivery = new AgentDelivery({
    server: {
      async notification(n: unknown) {
        if (failPush) throw failPush;
        pushes.push(n as (typeof pushes)[number]);
      },
    },
    broker,
    terminal: terminal as unknown as TerminalTyper,
    log: () => {},
    openCount: async () => 2,
    findAgent: async () => agent,
    pickupTimeoutMs: pickupMs,
  });
  return {
    broker,
    terminal,
    pushes,
    delivery,
    failPushWith: (e: Error) => {
      failPush = e;
    },
  };
}

test("a channel flag naming northstar is recognised, anything else is not", () => {
  assert.equal(listensToNorthstar(CLAUDE_WITH_CHANNEL), true);
  assert.equal(listensToNorthstar("claude --channels server:northstar"), true);
  assert.equal(listensToNorthstar("claude --channels=plugin:northstar@market"), true);
  assert.equal(listensToNorthstar("claude --channels server:other server:northstar"), true);
  assert.equal(listensToNorthstar("claude --channels server:other"), false);
  assert.equal(listensToNorthstar("claude --model opus server:northstar"), false);
  assert.equal(
    listensToNorthstar("claude --channels server:other --verbose server:northstar"),
    false,
  );
  assert.equal(listensToNorthstar("claude"), false);
});

test("Claude without the channel is not ready and the fix quotes the flag", async () => {
  const { delivery, pushes } = build({ kind: "claude-code", command: "claude" });
  const readiness = await delivery.readiness();
  assert.equal(readiness.ready, false);
  assert.match(readiness.fix ?? "", /--dangerously-load-development-channels server:northstar/);
  const outcome = await delivery.deliver();
  assert.equal(outcome.delivered, false);
  assert.equal(pushes.length, 0);
});

test("Claude with the channel gets one push and is delivered once it calls back", async () => {
  const { delivery, pushes, broker } = build(
    { kind: "claude-code", command: CLAUDE_WITH_CHANNEL },
    2000,
  );
  const pending = delivery.deliver();
  await new Promise((resolve) => setTimeout(resolve, 20));
  broker.markPolled();
  const outcome = await pending;
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.via, "channel");
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0]?.method, CHANNEL_METHOD);
  assert.deepEqual(pushes[0]?.params.meta, { count: "2" });
});

test("a push nobody answers is a failure, never typed into the terminal", async () => {
  const { delivery, terminal } = build({ kind: "claude-code", command: CLAUDE_WITH_CHANNEL });
  const outcome = await delivery.deliver();
  assert.equal(outcome.delivered, false);
  assert.match(outcome.reason ?? "", /did not start on the comments/);
  assert.equal(terminal.types, 0);
});

test("a failing push reports the error and the fix", async () => {
  const built = build({ kind: "claude-code", command: CLAUDE_WITH_CHANNEL });
  built.failPushWith(new Error("transport closed"));
  const outcome = await built.delivery.deliver();
  assert.equal(outcome.delivered, false);
  assert.match(outcome.reason ?? "", /transport closed/);
  assert.equal(built.terminal.types, 0);
});

test("Codex and Gemini are typed into once and never pushed", async () => {
  for (const kind of ["codex", "gemini"] as const) {
    const { delivery, terminal, pushes, broker } = build({ kind, command: kind }, 2000);
    terminal.onType = () => setTimeout(() => broker.markPolled(), 10);
    const outcome = await delivery.deliver();
    assert.equal(outcome.delivered, true);
    assert.equal(outcome.via, "terminal");
    assert.equal(terminal.types, 1);
    assert.equal(pushes.length, 0);
  }
});

test("a terminal that cannot be typed into surfaces its reason and fix", async () => {
  const { delivery, terminal } = build({ kind: "codex", command: "codex" });
  terminal.typeResult = { typed: false, reason: "text in the input", fix: "clear it" };
  const outcome = await delivery.deliver();
  assert.deepEqual(
    { delivered: outcome.delivered, reason: outcome.reason, fix: outcome.fix },
    { delivered: false, reason: "text in the input", fix: "clear it" },
  );
});

test("an unreadable terminal makes Codex not ready with the terminal's reason", async () => {
  const { delivery, terminal } = build({ kind: "codex", command: "codex" });
  terminal.check_ = { ok: false, reason: "no pane", fix: "use tmux" };
  const readiness = await delivery.readiness();
  assert.deepEqual(
    { ready: readiness.ready, reason: readiness.reason, fix: readiness.fix },
    { ready: false, reason: "no pane", fix: "use tmux" },
  );
  assert.equal((await delivery.deliver()).delivered, false);
  assert.equal(terminal.types, 0);
});

test("an unknown agent is not ready", async () => {
  const { delivery } = build({ kind: "other", command: "" });
  const readiness = await delivery.readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.via, null);
});
