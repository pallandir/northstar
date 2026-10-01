import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { HandoffOutcome, SessionInfo } from "@northstar/protocol";
import { templateLine } from "@northstar/protocol";
import { connectDaemon } from "../src/daemon/client.js";
import type { RpcPeer } from "../src/daemon/rpc.js";
import { type RunningDaemon, startDaemon } from "../src/daemon/server.js";
import { PtySession } from "../src/pty/pty-session.js";
import { draft } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const AGENT = fileURLToPath(new URL("./fixtures/test-agent.mjs", import.meta.url));
const TSX = fileURLToPath(import.meta.resolve("tsx"));

let home: string;
let project: string;
let running: RunningDaemon;
let browser: RpcPeer;
let agent: RpcPeer;
let wrapper: PtySession | null = null;
let exited: number | null = null;
let log: string;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(
  check: () => Promise<boolean> | boolean,
  what: string,
  ms = 10_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const ask = <T>(action: string, params: unknown = {}) =>
  browser.call<T>("request", { action, params });

before(async () => {
  home = mkdtempSync(join("/tmp", "ns-e2e-"));
  project = mkdtempSync(join("/tmp", "ns-e2ep-"));
  log = join(project, "received.log");
  running = await startDaemon({
    home,
    version: "9.9.9",
    log: () => {},
    idleExitMs: 60_000,
    pickupTimeoutMs: 5_000,
    launchQuickRun: () => {
      throw new Error("not used");
    },
  });
  browser = await connectDaemon(() => {}, null, home);
  agent = await connectDaemon(() => {}, null, home);
  await agent.call("mcp.hello", { root: project, ancestors: [] });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "NORTHSTAR_SESSION_ID") env[key] = value;
  }
  env.NORTHSTAR_HOME = home;
  env.TEST_AGENT_LOG = log;
  wrapper = new PtySession({
    file: process.execPath,
    args: ["--import", TSX, CLI, "run", process.execPath, AGENT, "idle"],
    cwd: project,
    env,
    cols: 100,
    rows: 30,
    onExit: (code) => {
      exited = code;
    },
  });
});

after(async () => {
  wrapper?.kill();
  browser?.close();
  agent?.close();
  await running?.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

test("northstar run registers the session, shows the agent and keeps the terminal interactive", async () => {
  await until(async () => (await ask<SessionInfo[]>("session.list")).length === 1, "the session");
  const [session] = await ask<SessionInfo[]>("session.list");
  assert.equal(session?.kind, "interactive");
  assert.ok(session?.cwd.endsWith(project.split("/").pop() as string));
  await until(
    () => (wrapper as PtySession).lines().join("\n").includes("Test Agent"),
    "the agent banner",
  );
});

test("a send from the browser side is typed into the agent and submitted by the wrapper", async () => {
  await ask("comments.add", { root: project, drafts: [draft()] });
  const poll = setInterval(() => {
    if (existsSync(log)) void agent.call("broker.polled", {});
  }, 50);
  try {
    const outcome = await ask<HandoffOutcome>("session.send", {
      root: project,
      template: "resolve",
    });
    assert.equal(outcome.delivered, true, JSON.stringify(outcome));
  } finally {
    clearInterval(poll);
  }
  assert.deepEqual(readFileSync(log, "utf8").split("\n").filter(Boolean), [
    templateLine("resolve"),
  ]);
});

test("typing in the terminal still reaches the agent through the wrapper", async () => {
  (wrapper as PtySession).userInput("hello");
  await until(
    () => (wrapper as PtySession).lines().join("\n").includes("hello"),
    "the echoed keystrokes",
  );
});

test("when the wrapper is stopped the agent ends, the session disappears and the exit is reported", async () => {
  (wrapper as PtySession).kill();
  await until(() => exited !== null, "the wrapper to exit");
  await until(
    async () => (await ask<SessionInfo[]>("session.list")).length === 0,
    "the session to go",
  );
});
