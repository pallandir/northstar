import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { HandoffOutcome, SessionInfo } from "@northstar/protocol";
import { templateLine } from "@northstar/protocol";
import { connectDaemon } from "../mcp/src/daemon/client.js";
import { DaemonLink } from "../mcp/src/daemon/link.js";
import type { RpcPeer } from "../mcp/src/daemon/rpc.js";
import { type RunningDaemon, startDaemon } from "../mcp/src/daemon/server.js";
import { executableOf } from "../mcp/src/terminal/process.js";
import type { TerminalDriver } from "../mcp/src/terminal/types.js";
import { draft } from "./helpers.js";

let home: string;
let project: string;
let running: RunningDaemon;
let peers: RpcPeer[];
let links: DaemonLink[];

beforeEach(async () => {
  home = mkdtempSync(join("/tmp", "ns-home-"));
  project = mkdtempSync(join("/tmp", "ns-proj-"));
  peers = [];
  links = [];
  running = await startDaemon({
    home,
    version: "9.9.9",
    log: () => {},
    pickupTimeoutMs: 3_000,
    idleExitMs: 60_000,
    launchQuickRun: () => {
      throw new Error("no quick run in this test");
    },
  });
});

afterEach(async () => {
  for (const peer of peers) peer.close();
  await running.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

class FakeDriver implements TerminalDriver {
  readonly name = "tmux" as const;
  typed: string[] = [];
  entered = 0;
  onEnter: () => void = () => {};
  constructor(private readonly screen: string) {}
  async capture(): Promise<string> {
    return this.screen;
  }
  async sendText(text: string): Promise<void> {
    this.typed.push(text);
  }
  async sendEnter(): Promise<void> {
    this.entered += 1;
    this.onEnter();
  }
}

function makeLink(driver: TerminalDriver | null, pid = 4242): DaemonLink {
  const link = new DaemonLink({
    root: project,
    home,
    log: () => {},
    ancestors: async () => [99999],
    findAgent: async () => ({ pid, command: "claude", tty: "/dev/ttys009", executable: "claude" }),
    detect: () =>
      driver
        ? { driver }
        : { driver: null, reason: "No terminal for this agent.", fix: "Use tmux." },
  });
  links.push(link);
  return link;
}

async function browser(): Promise<RpcPeer> {
  const peer = await connectDaemon(() => {}, null, home);
  peers.push(peer);
  return peer;
}

const request = <T>(peer: RpcPeer, action: string, params: unknown = {}) =>
  peer.call<T>("request", { action, params });

test("an agent started normally registers a terminal session and receives a send", async () => {
  const driver = new FakeDriver("done\n\n❯ \n");
  const link = makeLink(driver);
  driver.onEnter = () => link.polled();
  assert.equal((await link.start()).state, "on");

  const peer = await browser();
  const sessions = await request<SessionInfo[]>(peer, "session.list");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.kind, "terminal");
  assert.equal(sessions[0]?.agent, "claude");
  assert.equal(sessions[0]?.pid, 4242);

  await request(peer, "comments.add", { root: project, drafts: [draft()] });
  const outcome = await request<HandoffOutcome>(peer, "session.send", {
    root: project,
    template: "resolve",
  });
  assert.equal(outcome.delivered, true);
  assert.deepEqual(driver.typed, [templateLine("resolve")]);
  assert.equal(driver.entered, 1);
});

test("two Northstar servers of one agent share a single session", async () => {
  const first = makeLink(new FakeDriver(""));
  const second = makeLink(new FakeDriver(""));
  await first.start();
  await second.start();
  const sessions = await request<SessionInfo[]>(await browser(), "session.list");
  assert.equal(sessions.length, 1);
});

test("a terminal that cannot be typed into fails the send with its reason and fix", async () => {
  await makeLink(null).start();
  const peer = await browser();
  await request(peer, "comments.add", { root: project, drafts: [draft()] });
  await assert.rejects(
    request(peer, "session.send", { root: project, template: "resolve" }),
    (error: Error & { code?: string; fix?: string }) => {
      assert.equal(error.code, "BLOCKED");
      assert.match(error.message, /No terminal for this agent/);
      assert.equal(error.fix, "Use tmux.");
      return true;
    },
  );
});

test("the agent executable is read through a runtime and a login dash", () => {
  assert.equal(executableOf("claude"), "claude");
  assert.equal(executableOf("-zsh"), "zsh");
  assert.equal(executableOf("/usr/local/bin/node /opt/lib/bin/codex.js --flag"), "codex");
  assert.equal(executableOf("/Users/x/.local/bin/claude daemon run"), "claude");
});

test("unpacked Northstar builds are found in every Chrome profile and the others are ignored", async () => {
  const { findLocalExtensionIds, chromeUserDataDir } = await import(
    "../mcp/src/install/chrome-extensions.js"
  );
  const chrome = chromeUserDataDir(home, "darwin") as string;
  const make = (profile: string, entries: Record<string, { location: number; path: string }>) => {
    mkdirSync(join(chrome, profile), { recursive: true });
    writeFileSync(
      join(chrome, profile, "Secure Preferences"),
      JSON.stringify({ extensions: { settings: entries } }),
    );
  };
  const build = (name: string) => {
    const dir = mkdtempSync(join(home, "ext-"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ name }));
    return dir;
  };
  const mine = "a".repeat(32);
  const other = "b".repeat(32);
  const store = "c".repeat(32);
  const gone = "d".repeat(32);
  make("Default", {
    [mine]: { location: 4, path: build("Northstar") },
    [other]: { location: 4, path: build("Something else") },
    [store]: { location: 1, path: build("Northstar") },
    [gone]: { location: 4, path: join(home, "missing") },
  });
  make("Profile 2", { [`${"e".repeat(31)}f`]: { location: 4, path: build("Northstar") } });
  assert.deepEqual(findLocalExtensionIds(home, "darwin"), [mine, `${"e".repeat(31)}f`]);
});
