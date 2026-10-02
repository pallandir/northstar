import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { type HandoffOutcome, templateLine } from "@northstar/protocol";
import { connectDaemon } from "../mcp/src/daemon/client.js";
import type { RpcPeer } from "../mcp/src/daemon/rpc.js";
import { type RunningDaemon, startDaemon } from "../mcp/src/daemon/server.js";
import { CLI_ENTRY, draft } from "./helpers.js";

let home: string;
let project: string;
let running: RunningDaemon;
let peers: RpcPeer[];

beforeEach(async () => {
  home = mkdtempSync(join("/tmp", "ns-lhome-"));
  project = mkdtempSync(join("/tmp", "ns-lproj-"));
  peers = [];
  running = await startDaemon({ home, version: "9.9.9", log: () => {}, idleExitMs: 60_000 });
});

afterEach(async () => {
  for (const peer of peers) peer.close();
  await running.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

function runListen(...args: string[]) {
  const child = spawn(process.execPath, ["--import", "tsx", CLI_ENTRY, "listen", ...args], {
    env: { ...process.env, NORTHSTAR_HOME: home, NORTHSTAR_ROOT: project },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 1)));
  return { exited, output: () => ({ stdout, stderr }) };
}

async function browser(): Promise<RpcPeer> {
  const peer = await connectDaemon(() => {}, null, home);
  peers.push(peer);
  await peer.call("mcp.hello", { root: project, ancestors: [] });
  return peer;
}

const request = <T>(peer: RpcPeer, action: string, params: unknown) =>
  peer.call<T>("request", { action, params });

test("northstar listen blocks until Send to AI, prints the line and the open comments, and exits 0", async () => {
  const peer = await browser();
  await request(peer, "comments.add", {
    root: project,
    drafts: [draft({ comment: "Make it blue" })],
  });
  const listener = runListen("--timeout", "20");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await request<{ readiness: { ready: boolean } }>(peer, "status.get", {
      root: project,
    });
    if (status.readiness.ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const outcome = await request<HandoffOutcome>(peer, "session.send", {
    root: project,
    template: "resolve",
  });
  assert.equal(outcome.delivered, true);
  assert.equal(await listener.exited, 0);
  const { stdout } = listener.output();
  assert.ok(stdout.startsWith(templateLine("resolve")));
  assert.match(stdout, /Open comments:\n.*Make it blue/);
  assert.match(stdout, /run northstar listen again/);
});

test("northstar listen says so and exits 0 when nothing arrives before the timeout", async () => {
  await browser();
  const listener = runListen("--timeout", "1");
  const code = await listener.exited;
  assert.equal(code, 0, JSON.stringify(listener.output()));
  assert.match(listener.output().stdout, /No new comments\. Run northstar listen again\./);
});

test("northstar listen refuses a bad timeout with its usage", async () => {
  const listener = runListen("--timeout", "0");
  assert.equal(await listener.exited, 2);
  assert.match(listener.output().stderr, /--timeout takes whole seconds from 1 to 3600/);
});
