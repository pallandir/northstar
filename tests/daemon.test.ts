import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type {
  Comment,
  HandoffOutcome,
  PostCommentsResponse,
  SessionInfo,
} from "@northstar/protocol";
import { connectDaemon, ensureDaemon } from "../mcp/src/daemon/client.js";
import { RpcError, type RpcHandler, type RpcPeer } from "../mcp/src/daemon/rpc.js";
import { type RunningDaemon, startDaemon } from "../mcp/src/daemon/server.js";
import { chromeUserDataDir } from "../mcp/src/install/chrome-extensions.js";
import { installHost } from "../mcp/src/install/native-manifest.js";
import { socketPath } from "../mcp/src/lib/home.js";
import { draft } from "./helpers.js";

let home: string;
let project: string;
let running: RunningDaemon;
let peers: RpcPeer[];
let logs: string[];

function shortDir(prefix: string): string {
  return mkdtempSync(join("/tmp", prefix));
}

async function boot(pickupTimeoutMs = 400): Promise<RunningDaemon> {
  return startDaemon({
    home,
    version: "9.9.9",
    log: (message) => logs.push(message),
    pickupTimeoutMs,
    idleExitMs: 60_000,
  });
}

beforeEach(async () => {
  home = shortDir("ns-home-");
  project = shortDir("ns-proj-");
  peers = [];
  logs = [];
  running = await boot();
});

afterEach(async () => {
  for (const peer of peers) peer.close();
  await running.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

async function connect(handler: RpcHandler | null = null): Promise<RpcPeer> {
  const peer = await connectDaemon((m) => logs.push(m), handler, home);
  peers.push(peer);
  return peer;
}

async function request<T>(peer: RpcPeer, action: string, params: unknown = {}): Promise<T> {
  return peer.call<T>("request", { action, params });
}

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof RpcError, String(error));
    return error;
  }
  throw new Error("expected the call to fail");
}

const delivered = async () => ({ delivered: true });

async function session(
  agent: string,
  deliver: RpcHandler = delivered,
  extra: { cwd?: string; pid?: number } = {},
): Promise<{ peer: RpcPeer; id: string }> {
  const peer = await connect(async (method, params) => {
    assert.equal(method, "session.deliver");
    return deliver(method, params);
  });
  const id = randomUUID();
  await peer.call("session.register", {
    id,
    agent,
    command: `/usr/bin/${agent}`,
    cwd: extra.cwd ?? project,
    pid: extra.pid ?? process.pid,
  });
  return { peer, id };
}

async function mcp(root = project): Promise<RpcPeer> {
  const peer = await connect();
  await peer.call("mcp.hello", { root, ancestors: [process.pid] });
  return peer;
}

const post = (peer: RpcPeer, drafts: unknown[]) =>
  request<PostCommentsResponse>(peer, "comments.add", { root: project, drafts });

test("the socket and its directory are private to the user", () => {
  const path = socketPath(home);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(path, "..")).mode & 0o777, 0o700);
});

test("a second daemon refuses to start and a stale socket file is replaced", async () => {
  await assert.rejects(boot(), /already running/);
  await running.close();
  writeFileSync(socketPath(home), "stale");
  running = await boot();
  const peer = await connect();
  const info = await request<{ version: string }>(peer, "system.info");
  assert.equal(info.version, "9.9.9");
});

test("a registered session is listed with its metadata and dropped when it disconnects", async () => {
  const peer = await connect();
  const { peer: wrapper, id } = await session("claude");
  const [info] = await request<SessionInfo[]>(peer, "session.list");
  assert.equal(info?.id, id);
  assert.equal(info?.agent, "claude");
  assert.equal(info?.cwd, project);
  assert.ok(existsSync(join(home, ".northstar", "state", "sessions.json")));
  wrapper.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(await request(peer, "session.list"), []);
});

test("a duplicate session id is refused", async () => {
  const { id } = await session("claude");
  const second = await connect();
  const error = await failure(
    second.call("session.register", {
      id,
      agent: "codex",
      command: "/x",
      cwd: project,
      pid: 1,
    }),
  );
  assert.equal(error.code, "BAD_REQUEST");
});

test("a send with an assistant open but no session tells the designer to copy the line", async () => {
  const peer = await connect();
  await mcp();
  await post(peer, [draft()]);
  const error = await failure(
    request(peer, "session.send", { root: project, template: "resolve" }),
  );
  assert.equal(error.code, "NO_SESSION");
  assert.match(error.message, /open in this project but Northstar cannot write to it/);
  assert.match(error.fix, /Copy the line/);
});

test("an assistant that is working on comments is reported as working, not as unreachable", async () => {
  const peer = await connect();
  const agent = await mcp();
  await post(peer, [draft()]);
  const idle = await request<{ readiness: { working?: boolean } }>(peer, "status.get", {
    root: project,
  });
  assert.equal(idle.readiness.working, false);
  await agent.call("broker.polled", {});
  const busy = await request<{ readiness: { ready: boolean; working?: boolean; reason?: string } }>(
    peer,
    "status.get",
    { root: project },
  );
  assert.equal(busy.readiness.ready, false);
  assert.equal(busy.readiness.working, true);
  assert.match(busy.readiness.reason ?? "", /working on your comments/);
  const error = await failure(
    request(peer, "session.send", { root: project, template: "resolve" }),
  );
  assert.match(error.message, /working on your comments/);
});

const listenOnce = (peer: RpcPeer, timeoutMs: number) =>
  peer.call<{ template: string | null }>("listen.wait", { root: project, timeoutMs }, 10_000);

test("a listening assistant is ready, receives the send and the toolbar learns it was delivered", async () => {
  const browser = await connect();
  await mcp();
  await post(browser, [draft()]);
  const listener = await connect();
  const waiting = listenOnce(listener, 8_000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const status = await request<{ readiness: { ready: boolean } }>(browser, "status.get", {
    root: project,
  });
  assert.equal(status.readiness.ready, true);
  const outcome = await request<HandoffOutcome>(browser, "session.send", {
    root: project,
    template: "implement",
  });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.session, null);
  assert.deepEqual(await waiting, { template: "implement" });
});

test("a send while the assistant is between listens is queued and the next listen returns it at once", async () => {
  const browser = await connect();
  await mcp();
  await post(browser, [draft()]);
  const first = await connect();
  assert.deepEqual(await listenOnce(first, 50), { template: null });
  const outcome = await request<HandoffOutcome>(browser, "session.send", {
    root: project,
    template: "resolve",
  });
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.blocked, "busy");
  assert.match(outcome.reason ?? "", /queued/);
  const second = await connect();
  const started = Date.now();
  assert.deepEqual(await listenOnce(second, 8_000), { template: "resolve" });
  assert.ok(Date.now() - started < 2_000);
});

test("a listener that disconnects frees the wait and a session still wins over a listener", async () => {
  const browser = await connect();
  await mcp();
  await post(browser, [draft()]);
  const listener = await connect();
  const waiting = listenOnce(listener, 8_000).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 100));
  listener.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const received: unknown[] = [];
  await session("codex", async (_method, params) => {
    received.push(params);
    return { delivered: true };
  });
  const agent = await mcp();
  setTimeout(() => void agent.call("broker.polled", {}), 20);
  const outcome = await request<HandoffOutcome>(browser, "session.send", {
    root: project,
    template: "fix",
  });
  assert.equal(outcome.delivered, true);
  assert.deepEqual(received, [{ template: "fix" }]);
  assert.equal(await waiting, null);
});

test("an assistant starting allows an unpacked extension build the helper already refuses", async () => {
  installHost({ home, node: "/usr/bin/node", script: "/opt/northstar/cli.js", extensionIds: [] });
  const id = "p".repeat(32);
  const build = join(project, "ext");
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, "manifest.json"), JSON.stringify({ name: "Northstar" }));
  const profile = join(chromeUserDataDir(home, process.platform) as string, "Default");
  mkdirSync(profile, { recursive: true });
  writeFileSync(
    join(profile, "Secure Preferences"),
    JSON.stringify({ extensions: { settings: { [id]: { location: 4, path: build } } } }),
  );
  await mcp();
  const manifest = join(
    process.platform === "darwin"
      ? join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")
      : join(home, ".config", "google-chrome", "NativeMessagingHosts"),
    "com.northstar.bridge.json",
  );
  const origins = JSON.parse(readFileSync(manifest, "utf8")).allowed_origins as string[];
  assert.ok(origins.includes(`chrome-extension://${id}/`));
});

test("a send with no assistant connected says to open one", async () => {
  const peer = await connect();
  const hello = await mcp();
  await post(peer, [draft()]);
  hello.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const error = await failure(
    request(peer, "session.send", { root: project, template: "resolve" }),
  );
  assert.equal(error.code, "NO_SESSION");
  assert.match(error.message, /No AI assistant is connected/);
  assert.match(error.fix, /Open your AI assistant/);
});

test("a send with one session is delivered and confirmed by the agent reading the comments", async () => {
  const browser = await connect();
  const agent = await mcp();
  const received: unknown[] = [];
  await session("codex", async (_method, params) => {
    received.push(params);
    setTimeout(() => void agent.call("broker.polled", {}), 20);
    return { delivered: true };
  });
  await post(browser, [draft()]);
  const outcome = await request<HandoffOutcome>(browser, "session.send", {
    root: project,
    template: "implement",
  });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.session?.agent, "codex");
  assert.deepEqual(received, [{ template: "implement" }]);
  const status = await request<{ handoff: HandoffOutcome | null }>(browser, "status.get", {
    root: project,
  });
  assert.equal(status.handoff?.delivered, true);
});

test("a delivery the agent never picks up is reported as failed with a fix", async () => {
  const browser = await connect();
  await mcp();
  await session("codex");
  await post(browser, [draft()]);
  const outcome = await request<HandoffOutcome>(browser, "session.send", {
    root: project,
    template: "resolve",
  });
  assert.equal(outcome.delivered, false);
  assert.match(outcome.reason ?? "", /did not start on the comments/);
  assert.ok(outcome.fix);
});

test("a blocked delivery is passed on with why and how to fix it", async () => {
  const browser = await connect();
  await mcp();
  await session("claude", async () => ({
    delivered: false,
    blocked: "prompt",
    reason: "the agent is waiting on a prompt, Northstar will not answer it for you",
    fix: "Answer the prompt in the agent, then click Send to AI again.",
  }));
  await post(browser, [draft()]);
  const outcome = await request<HandoffOutcome>(browser, "session.send", {
    root: project,
    template: "resolve",
  });
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.blocked, "prompt");
  assert.match(outcome.reason ?? "", /Claude Code/);
  assert.match(outcome.fix ?? "", /Answer the prompt/);
});

test("two sessions need a pick unless one agent is preferred or a session is named", async () => {
  const browser = await connect();
  const agent = await mcp();
  const claude = await session("claude", async () => {
    setTimeout(() => void agent.call("broker.polled", {}), 20);
    return { delivered: true };
  });
  const codex = await session("codex", async () => {
    setTimeout(() => void agent.call("broker.polled", {}), 20);
    return { delivered: true };
  });
  await post(browser, [draft()]);

  const status = await request<{ readiness: { needsPick: boolean; sessions: SessionInfo[] } }>(
    browser,
    "status.get",
    { root: project },
  );
  assert.equal(status.readiness.needsPick, true);
  assert.equal(status.readiness.sessions.length, 2);
  const pick = await failure(
    request(browser, "session.send", { root: project, template: "resolve" }),
  );
  assert.equal(pick.code, "PICK_SESSION");

  const named = await request<HandoffOutcome>(browser, "session.send", {
    root: project,
    template: "resolve",
    sessionId: codex.id,
  });
  assert.equal(named.session?.agent, "codex");

  await request(browser, "config.set", { preferredAgent: "claude" });
  const preferred = await request<HandoffOutcome>(browser, "session.send", {
    root: project,
    template: "resolve",
  });
  assert.equal(preferred.session?.id, claude.id);

  const missing = await failure(
    request(browser, "session.send", {
      root: project,
      template: "resolve",
      sessionId: "nope-nope-nope",
    }),
  );
  assert.equal(missing.code, "SESSION_NOT_FOUND");
});

test("sessions only receive sends for their own project", async () => {
  const other = shortDir("ns-other-");
  try {
    const browser = await connect();
    await session("claude", delivered, { cwd: other });
    await session("codex");
    const status = await request<{ readiness: { sessions: SessionInfo[]; target: string | null } }>(
      browser,
      "status.get",
      { root: project },
    );
    assert.deepEqual(
      status.readiness.sessions.map((s) => s.agent),
      ["codex"],
    );
    const projects = await request<Array<{ root: string }>>(browser, "project.list");
    assert.equal(projects.length, 2);
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test("a send needs an open comment and only one runs at a time", async () => {
  const browser = await connect();
  await mcp();
  const gate: { release: () => void } = { release: () => {} };
  await session(
    "codex",
    () =>
      new Promise((resolve) => {
        gate.release = () => resolve({ delivered: false, blocked: "busy", reason: "r", fix: "f" });
      }),
  );
  const none = await failure(
    request(browser, "session.send", { root: project, template: "resolve" }),
  );
  assert.match(none.message, /no open comments/);

  await post(browser, [draft()]);
  const first = request(browser, "session.send", { root: project, template: "resolve" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = await failure(
    request(browser, "session.send", { root: project, template: "resolve" }),
  );
  assert.equal(second.code, "BLOCKED");
  gate.release();
  await first;
});

test("an unknown project root or action is refused and creates nothing", async () => {
  const peer = await connect();
  const outside = shortDir("ns-outside-");
  try {
    const root = await failure(
      request(peer, "comments.list", { root: outside, page: "http://localhost:3000/" }),
    );
    assert.equal(root.code, "NO_PROJECT");
    assert.equal(existsSync(join(outside, ".northstar")), false);
    const action = await failure(request(peer, "shell.exec", { command: "id" }));
    assert.equal(action.code, "UNSUPPORTED_ACTION");
    const method = await failure(peer.call("exec", { command: "id" }));
    assert.equal(method.code, "UNSUPPORTED_ACTION");
    const shape = await failure(
      request(peer, "session.send", { root: project, template: "rm -rf /" }),
    );
    assert.equal(shape.code, "BAD_REQUEST");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("comments are validated per item and nothing is clipped or stripped", async () => {
  const peer = await connect();
  await mcp();
  const res = await post(peer, [
    draft({ cid: "good-1" }),
    { cid: "bad-1", comment: "missing everything" },
    draft({ cid: "bad-2", comment: "x".repeat(8_001) }),
    draft({ cid: "good-2", comment: "second" }),
  ]);
  assert.deepEqual(
    res.accepted.map((a) => a.cid),
    ["good-1", "good-2"],
  );
  assert.deepEqual(
    res.rejected.map((r) => r.cid),
    ["bad-1", "bad-2"],
  );
  assert.equal(res.rejected[1]?.field, "comment");
  assert.match(res.rejected[1]?.error ?? "", /at most 8000/);
});

test("a batch with no valid comment names the field and accepts none", async () => {
  const peer = await connect();
  await mcp();
  const { cid: _cid, ...noCid } = draft();
  const res = await post(peer, [noCid]);
  assert.deepEqual(res.accepted, []);
  assert.equal(res.rejected[0]?.field, "cid");
  assert.ok(res.rejected[0]?.fix);
  const unknown = await post(peer, [{ ...draft(), extra: 1 }]);
  assert.match(unknown.rejected[0]?.error ?? "", /unknown keys extra/);
});

test("source paths outside the project are rejected and inside ones are kept relative", async () => {
  const peer = await connect();
  await mcp();
  for (const path of ["../etc/passwd", "/etc/passwd", "~/x.ts"]) {
    const res = await post(peer, [draft({ source: { path, line: 1, column: 0, via: "x" } })]);
    assert.equal(res.rejected[0]?.field, "source.path");
  }
  const inside = await post(peer, [
    draft({ source: { path: join(project, "src", "App.tsx"), line: 1, column: 0, via: "x" } }),
  ]);
  const comments = await request<Comment[]>(peer, "comments.list", {
    root: project,
    page: "http://localhost:3000/",
  });
  const stored = comments.find((c) => c.id === inside.ids[0]);
  assert.equal(stored?.source?.path, "src/App.tsx");
});

test("a repeated cid is stored once", async () => {
  const peer = await connect();
  await mcp();
  const first = await post(peer, [draft({ cid: "dup-1" })]);
  const second = await post(peer, [draft({ cid: "dup-1" })]);
  assert.equal(second.accepted[0]?.id, first.accepted[0]?.id);
  const all = await request<Comment[]>(peer, "comments.list", {
    root: project,
    page: "http://localhost:3000/",
  });
  assert.equal(all.filter((c) => c.cid === "dup-1").length, 1);
});

test("clear needs exactly one of page and all, and reopen validates what it is given", async () => {
  const peer = await connect();
  await mcp();
  const added = await post(peer, [
    draft(),
    draft({
      comment: "other page",
      url: "http://localhost:3000/b",
      metadata: { page: "/b", viewport: { w: 1, h: 1 }, elementText: "" },
    }),
  ]);
  const both = await failure(request(peer, "comments.clear", { root: project }));
  assert.equal(both.code, "BAD_REQUEST");
  const cleared = await request<{ removed: number }>(peer, "comments.clear", {
    root: project,
    page: "http://localhost:3000/b",
  });
  assert.equal(cleared.removed, 1);

  const open = await failure(request(peer, "comments.reopen", { root: project, id: added.ids[0] }));
  assert.match(open.message, /already open/);
  const gone = await failure(request(peer, "comments.reopen", { root: project, id: "missing" }));
  assert.match(gone.message, /no longer exists/);
  const all = await request<{ removed: number }>(peer, "comments.clear", {
    root: project,
    all: true,
  });
  assert.equal(all.removed, 1);
});

test("notices from the agent reach the status and can be dismissed", async () => {
  const peer = await connect();
  const agent = await mcp();
  await agent.call("broker.notice", {
    commentId: "c1",
    page: "http://localhost:3000/",
    summary: "needs a plan",
    createdAt: new Date().toISOString(),
  });
  let status = await request<{ notices: Array<{ commentId: string }> }>(peer, "status.get", {
    root: project,
  });
  assert.equal(status.notices[0]?.commentId, "c1");
  await request(peer, "notices.dismiss", { root: project, commentId: "c1" });
  status = await request(peer, "status.get", { root: project });
  assert.deepEqual(status.notices, []);
});

test("project.resolve counts the source files under each root and refuses unsafe paths", async () => {
  const peer = await connect();
  await mcp();
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "App.jsx"), "export default 1");
  const found = await request<{ owners: Array<{ root: string; matches: number; depth: number }> }>(
    peer,
    "project.resolve",
    { paths: ["src/App.jsx", "src/Missing.jsx"] },
  );
  assert.equal(
    found.owners.find((o) => o.root.endsWith(project.split("/").pop() as string))?.matches,
    1,
  );

  const refused = ["../etc/passwd", "src/../../secret"];
  for (const path of refused) {
    const error = await failure(request(peer, "project.resolve", { paths: [path] }));
    assert.equal(error.code, "BAD_REQUEST");
  }
  const outside = shortDir("ns-esc-");
  try {
    writeFileSync(join(outside, "secret.txt"), "x");
    symlinkSync(outside, join(project, "escape"));
    const escaped = await request<{ owners: Array<{ matches: number }> }>(peer, "project.resolve", {
      paths: ["escape/secret.txt"],
    });
    assert.equal(
      escaped.owners.reduce((n, o) => n + o.matches, 0),
      0,
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a mapped page resolves to its project directory", async () => {
  const peer = await connect();
  await request(peer, "config.set", { projects: { "localhost:5173/app": project } });
  const resolved = await request<{ mapped: string | null }>(peer, "project.resolve", {
    paths: [],
    page: "http://localhost:5173/app/users/1",
  });
  assert.ok(resolved.mapped?.endsWith(project.split("/").pop() as string));
  const none = await request<{ mapped: string | null }>(peer, "project.resolve", {
    paths: [],
    page: "http://localhost:5173/other",
  });
  assert.equal(none.mapped, null);
  const known = await request<Array<{ root: string }>>(peer, "project.list");
  assert.equal(known.length, 1);
});

test("config round trips and an invalid file fails loudly with its path", async () => {
  const peer = await connect();
  const set = await request<{ preferredAgent: string | null; template: string }>(
    peer,
    "config.set",
    {
      preferredAgent: "codex",
      template: "fix",
    },
  );
  assert.equal(set.preferredAgent, "codex");
  assert.equal(set.template, "fix");
  const text = readFileSync(join(home, ".northstar", "config.yaml"), "utf8");
  assert.match(text, /preferredAgent: codex/);
  writeFileSync(join(home, ".northstar", "config.yaml"), "preferences:\n  template: nope\n");
  const error = await failure(request(peer, "config.get"));
  assert.equal(error.code, "BAD_REQUEST");
  assert.match(error.message, /config\.yaml is invalid at preferences\.template/);
});

test("ensureDaemon starts a missing daemon through the supplied launcher and gives up with a fix", async () => {
  await running.close();
  let started = 0;
  const viaStart = await ensureDaemon(
    (m) => logs.push(m),
    null,
    home,
    () => {
      started += 1;
      void boot().then((daemon) => {
        running = daemon;
      });
    },
  );
  peers.push(viaStart);
  assert.equal(started, 1);
  assert.equal((await request<{ version: string }>(viaStart, "system.info")).version, "9.9.9");

  await running.close();
  await assert.rejects(
    ensureDaemon(
      () => {},
      null,
      home,
      () => {},
      300,
    ),
    (error: Error) => error instanceof RpcError && /did not start/.test(error.message),
  );
});
