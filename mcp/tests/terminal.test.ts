import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { findControllingTty } from "../src/terminal/discover.js";
import { TerminalHandoff, awaitingAnswer, typedInput } from "../src/terminal/inject.js";
import { type AgentKind, CLAUDE_CODE_LINE, HANDOFF_LINE } from "../src/terminal/payload.js";
import type { DriverName, TerminalDriver } from "../src/terminal/types.js";

class FakeDriver implements TerminalDriver {
  readonly name: DriverName = "tmux";
  writes: string[] = [];
  enters = 0;
  captureError: Error | null = null;

  constructor(private screens: string[]) {}

  async capture(): Promise<string> {
    if (this.captureError) throw this.captureError;
    return this.screens.length > 1 ? (this.screens.shift() as string) : this.screens[0];
  }

  async sendText(text: string): Promise<void> {
    this.writes.push(text);
  }

  async sendEnter(): Promise<void> {
    this.enters += 1;
  }
}

function handoffWith(
  driver: TerminalDriver | null,
  reason?: string,
  agent: AgentKind = "other",
): TerminalHandoff {
  const handoff = new TerminalHandoff(
    () => {},
    1200,
    async () => agent,
  );
  Object.assign(handoff, { detection: { driver, reason } });
  return handoff;
}

const IDLE = "> \n";
const PERMISSION_PROMPT = `Do you want to make this edit?
❯ 1. Yes
  2. No, and tell Claude what to do differently`;

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

test("findControllingTty walks past the detached server to the agent's terminal", async () => {
  const tty = await findControllingTty();
  assert.ok(tty === null || /^\/dev\/\w+/.test(tty), `unexpected tty ${tty}`);
});

test("a settled screen gets the line and a separate Enter", async () => {
  const driver = new FakeDriver([IDLE]);
  const result = await handoffWith(driver).send();
  assert.equal(result.typed, true);
  assert.equal(result.driver, "tmux");
  assert.deepEqual(driver.writes, [HANDOFF_LINE]);
  assert.equal(driver.enters, 1);
});

test("a Claude Code agent gets the resolve-comments slash command", async () => {
  const driver = new FakeDriver([IDLE]);
  const result = await handoffWith(driver, undefined, "claude-code").send();
  assert.equal(result.typed, true);
  assert.deepEqual(driver.writes, [CLAUDE_CODE_LINE]);
  assert.equal(CLAUDE_CODE_LINE, "/mcp__northstar__resolve-comments");
});

test("the typed line carries no caller-controlled text", () => {
  assert.ok(!/\n|\r/.test(HANDOFF_LINE));
  assert.ok(HANDOFF_LINE.includes("list_comments"));
  assert.ok(HANDOFF_LINE.includes("get_comment"));
  assert.ok(HANDOFF_LINE.includes("resolve_comment"));
});

test("a pending choice prompt is never answered", async () => {
  const driver = new FakeDriver([PERMISSION_PROMPT]);
  const result = await handoffWith(driver).send();
  assert.equal(result.typed, false);
  assert.match(result.reason ?? "", /waiting on a prompt/);
  assert.equal(driver.writes.length, 0);
  assert.equal(driver.enters, 0);
});

test("a yes/no confirmation is never answered", async () => {
  const driver = new FakeDriver(["Overwrite the file? (y/n)"]);
  const result = await handoffWith(driver).send();
  assert.equal(result.typed, false);
  assert.equal(driver.enters, 0);
});

test("output still moving is waited out, then typed", async () => {
  const driver = new FakeDriver(["building...", "building... done", IDLE]);
  const result = await handoffWith(driver).send();
  assert.equal(result.typed, true);
  assert.deepEqual(driver.writes, [HANDOFF_LINE]);
});

test("a driver that cannot be read fails closed", async () => {
  const driver = new FakeDriver([IDLE]);
  driver.captureError = new Error("osascript denied");
  const result = await handoffWith(driver).send();
  assert.equal(result.typed, false);
  assert.match(result.reason ?? "", /osascript denied/);
  assert.equal(driver.writes.length, 0);
});

test("no detected terminal reports the reason instead of throwing", async () => {
  const result = await handoffWith(null, "no supported terminal detected").send();
  assert.equal(result.typed, false);
  assert.equal(result.reason, "no supported terminal detected");
});

test("describe reports availability for the toolbar", async () => {
  assert.deepEqual(await handoffWith(new FakeDriver([IDLE])).describe(), {
    available: true,
    driver: "tmux",
  });
  assert.deepEqual(await handoffWith(null, "nope").describe(), {
    available: false,
    reason: "nope",
  });
});

test("back-to-back sends are coalesced into one typed line", async () => {
  const driver = new FakeDriver([IDLE]);
  const handoff = handoffWith(driver);
  const [a, b] = await Promise.all([handoff.send(), handoff.send()]);
  assert.equal(a.typed, true);
  assert.equal(b.typed, false);
  assert.match(b.reason ?? "", /folded into the batch/);
  assert.equal(driver.writes.length, 1, "the second batch rides the first announcement");
  assert.equal(driver.enters, 1);
});

test("a flood on loopback cannot type at the agent repeatedly", async () => {
  const driver = new FakeDriver([IDLE]);
  const handoff = handoffWith(driver);
  for (let i = 0; i < 20; i += 1) await handoff.send();
  assert.equal(driver.writes.length, 1);
});

const lines = (screen: string) => screen.split("\n").filter(Boolean);

test("text already in the agent input is never typed over", async () => {
  const driver = new FakeDriver(["> fix the hero spac\n"]);
  const result = await handoffWith(driver).send();
  assert.equal(result.typed, false);
  assert.match(result.reason ?? "", /text in the agent input/);
  assert.equal(driver.writes.length, 0);
  assert.equal(driver.enters, 0);
});

test("a boxed empty input and a placeholder count as empty", () => {
  assert.equal(typedInput(lines("╭──╮\n│ >   │\n╰──╯\n  ? for shortcuts")), "");
  assert.equal(typedInput(lines('│ > Try "fix lint errors" │')), "");
  assert.equal(typedInput(lines("│ > half a sentence │")), "half a sentence");
  assert.equal(typedInput(lines("just output")), null);
});

test("only the last line decides a confirm prompt and a stale choice list is ignored", () => {
  assert.equal(awaitingAnswer(lines("Overwrite? (y/n)\nthen more output")), false);
  assert.equal(awaitingAnswer(lines("Overwrite? (y/n)")), true);
  assert.equal(awaitingAnswer(lines("❯ 1. old option\n  2. other\nDone, all green")), false);
  assert.equal(awaitingAnswer(lines("Pick one\n❯ 1. Yes\n  2. No")), true);
  assert.equal(awaitingAnswer(lines("  1. just a numbered list\n  2. in the output")), false);
});

test("an agent that cannot be identified reports the reason and types nothing", async () => {
  const driver = new FakeDriver([IDLE]);
  const handoff = new TerminalHandoff(
    () => {},
    1200,
    async () => {
      throw new Error("ps unavailable");
    },
  );
  Object.assign(handoff, { detection: { driver } });
  const result = await handoff.send();
  assert.equal(result.typed, false);
  assert.match(result.reason ?? "", /ps unavailable/);
  assert.equal(driver.writes.length, 0);
});

test("a transient detection failure is not cached", async () => {
  const handoff = new TerminalHandoff(() => {}, 1200);
  process.env.NORTHSTAR_TERMINAL = "none";
  assert.equal((await handoff.describe()).available, false);
  process.env.NORTHSTAR_TERMINAL = "tmux";
  process.env.TMUX_PANE = "%1";
  assert.equal((await handoff.describe()).available, false, "a definitive answer is cached");
});
