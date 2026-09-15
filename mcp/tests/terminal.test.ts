import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { findControllingTty } from "../src/terminal/discover.js";
import { TerminalHandoff } from "../src/terminal/inject.js";
import { HANDOFF_LINE } from "../src/terminal/payload.js";
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

function handoffWith(driver: TerminalDriver | null, reason?: string): TerminalHandoff {
  const handoff = new TerminalHandoff(() => {}, 1200);
  Object.assign(handoff, { detection: Promise.resolve({ driver, reason }) });
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

test("the typed line carries no caller-controlled text", () => {
  assert.ok(!/\n|\r/.test(HANDOFF_LINE));
  assert.ok(HANDOFF_LINE.includes("list_comments"));
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
  assert.equal(b.typed, true);
  assert.equal(driver.writes.length, 1, "the second batch rides the first announcement");
  assert.equal(driver.enters, 1);
});

test("a flood on loopback cannot type at the agent repeatedly", async () => {
  const driver = new FakeDriver([IDLE]);
  const handoff = handoffWith(driver);
  for (let i = 0; i < 20; i += 1) await handoff.send();
  assert.equal(driver.writes.length, 1);
});
