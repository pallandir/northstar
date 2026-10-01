import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PROTOCOL_HEADER, PROTOCOL_VERSION, TOKEN_HEADER, isApiError } from "@northstar/protocol";
import { Broker } from "../src/broker.js";
import { type IngestServer, startIngestServer } from "../src/http.js";
import { tokenPath } from "../src/lib/token.js";
import { CommentStore } from "../src/store.js";
import type { Handoff, HandoffResult, TerminalStatus } from "../src/terminal/index.js";
import { draft } from "./fixtures.js";

let server: IngestServer;
let root: string;
let home: string;
let token: string;
let handoff: FakeHandoff;
let logs: string[];

class FakeHandoff implements Handoff {
  sends = 0;
  result: HandoffResult = { typed: true, driver: "tmux" };
  gate: Promise<void> | null = null;

  async describe(): Promise<TerminalStatus> {
    return { available: true, driver: "tmux" };
  }

  async send(): Promise<HandoffResult> {
    this.sends += 1;
    if (this.gate) await this.gate;
    return this.result;
  }
}

class BrokenStore extends CommentStore {
  override async list(): Promise<never> {
    throw new Error("disk exploded");
  }
}

interface Reply {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
  target: IngestServer = server,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: target.port, method, path, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const ext = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const host = (target: IngestServer = server) => `127.0.0.1:${target.port}`;
const authed = (extra: Record<string, string> = {}) => ({
  Host: host(),
  Origin: ext,
  [TOKEN_HEADER]: token,
  ...extra,
});
const jsonHeaders = () => authed({ "Content-Type": "application/json" });
const parse = (reply: Reply) => JSON.parse(reply.body);
const post = (items: unknown) => call("POST", "/comments", jsonHeaders(), JSON.stringify(items));
const PAGE = encodeURIComponent("http://localhost:3000/");

function assertApiError(reply: Reply, status: number): void {
  assert.equal(reply.status, status, reply.body);
  assert.ok(isApiError(parse(reply)), reply.body);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-http-"));
  home = await mkdtemp(join(tmpdir(), "northstar-home-"));
  handoff = new FakeHandoff();
  logs = [];
  server = await startIngestServer(
    new CommentStore(root),
    [0],
    (m) => logs.push(m),
    new Broker(),
    handoff,
    { home },
  );
  token = (await readFile(tokenPath(home), "utf8")).trim();
});

after(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

test("the token is 32 random bytes in a file only the owner can read", async () => {
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal((await stat(tokenPath(home))).mode & 0o777, 0o600);
});

test("a second server reuses the token and a malformed token file is an error", async () => {
  const other = await startIngestServer(
    new CommentStore(root),
    [0],
    () => {},
    new Broker(),
    handoff,
    {
      home,
    },
  );
  const health = await call(
    "GET",
    "/health",
    { Host: host(other), [TOKEN_HEADER]: token },
    undefined,
    other,
  );
  assert.equal(parse(health).paired, true);
  await other.close();

  const bad = await mkdtemp(join(tmpdir(), "northstar-badhome-"));
  await startIngestServer(new CommentStore(root), [0], () => {}, new Broker(), handoff, {
    home: bad,
  })
    .then((s) => s.close())
    .then(() => writeFile(tokenPath(bad), "short"));
  await assert.rejects(
    startIngestServer(new CommentStore(root), [0], () => {}, new Broker(), handoff, { home: bad }),
    (error: Error) => error.message.includes(tokenPath(bad)) && /Delete it/.test(error.message),
  );
  await rm(bad, { recursive: true, force: true });
});

test("/health is open, minimal and says whether the caller is paired", async () => {
  const anonymous = await call("GET", "/health", { Host: host() });
  assert.equal(anonymous.status, 200);
  const body = parse(anonymous);
  assert.deepEqual(Object.keys(body).sort(), [
    "ok",
    "paired",
    "protocol",
    "root",
    "service",
    "startedAt",
    "version",
  ]);
  assert.equal(body.service, "northstar");
  assert.equal(body.protocol, PROTOCOL_VERSION);
  assert.equal(body.root, root);
  assert.equal(body.paired, false);
  assert.equal(typeof body.version, "string");

  const paired = await call("GET", "/health", authed());
  assert.equal(parse(paired).paired, true);
  const wrong = await call("GET", "/health", authed({ [TOKEN_HEADER]: "0".repeat(64) }));
  assert.equal(parse(wrong).paired, false);
});

test("every response varies on Origin and CORS allows the token header", async () => {
  const res = await call("GET", "/health", authed());
  assert.equal(res.headers.vary, "Origin");
  assert.equal(res.headers["access-control-allow-origin"], ext);
  assert.match(String(res.headers["access-control-allow-headers"]), /x-northstar-token/i);
});

test("a missing or wrong token is a 401 with a fix", async () => {
  const attempts: Record<string, string>[] = [
    { Host: host(), Origin: ext },
    { Host: host(), Origin: ext, [TOKEN_HEADER]: "f".repeat(64) },
    { Host: host(), Origin: ext, [TOKEN_HEADER]: "short" },
  ];
  for (const headers of attempts) {
    const res = await call("GET", "/comments?page=x", headers);
    assertApiError(res, 401);
    assert.equal(parse(res).error, "This browser is not connected to Northstar.");
    assert.equal(parse(res).fix, "Click Connect in the Northstar toolbar.");
  }
  assertApiError(await call("GET", "/state", { Host: host(), Origin: ext }), 401);
  assertApiError(await call("GET", "/status", { Host: host(), Origin: ext }), 401);
  assertApiError(
    await call("POST", "/comments", { Host: host(), Origin: ext }, JSON.stringify([draft()])),
    401,
  );
});

test("a web page origin and null origin are 403 even with the token", async () => {
  for (const origin of ["http://evil.test", "null", "http://localhost:3000"]) {
    const res = await call(
      "POST",
      "/comments",
      jsonHeaders_with(origin),
      JSON.stringify([draft()]),
    );
    assertApiError(res, 403);
  }
  assertApiError(await call("GET", "/health", { Host: host(), Origin: "null" }), 403);
});

function jsonHeaders_with(origin: string): Record<string, string> {
  return {
    Host: host(),
    Origin: origin,
    [TOKEN_HEADER]: token,
    "Content-Type": "application/json",
  };
}

test("an absent Origin is allowed because extension GET requests carry none, and the token still decides", async () => {
  assert.equal((await call("GET", "/health", { Host: host() })).status, 200);
  assert.equal((await call("GET", "/pair", { Host: host() })).status, 200);
  assertApiError(await call("GET", "/state", { Host: host() }), 401);
  assert.equal((await call("GET", "/state", { Host: host(), [TOKEN_HEADER]: token })).status, 200);
  assertApiError(await call("POST", "/comments", { Host: host() }, JSON.stringify([draft()])), 401);
});

test("the Host must be loopback on this port, parsed safely for IPv6", async () => {
  for (const bad of [
    "attacker.test",
    `127.0.0.1.evil.test:${server.port}`,
    "127.0.0.1:1",
    "[::1]",
    `[::2]:${server.port}`,
  ]) {
    assertApiError(await call("GET", "/health", { Host: bad }), 403);
  }
  for (const good of [`[::1]:${server.port}`, `localhost:${server.port}`, host()]) {
    assert.equal((await call("GET", "/health", { Host: good })).status, 200, good);
  }
});

test("firefox and chrome extension origins are accepted, others are not", async () => {
  assert.equal(
    (await call("GET", "/status", authed({ Origin: "moz-extension://abc-123" }))).status,
    200,
  );
  assert.equal(
    (await call("GET", "/status", authed({ Origin: "chrome-extension://anyid" }))).status,
    200,
  );
  assertApiError(await call("GET", "/status", authed({ Origin: "chrome-extension://a/b" })), 403);
  assertApiError(await call("GET", "/status", authed({ Origin: "https://x.test" })), 403);
});

test("an extra origins environment variable no longer opens anything", async () => {
  process.env.NORTHSTAR_EXTRA_ORIGINS = "devid";
  try {
    assertApiError(await call("GET", "/status", authed({ Origin: "http://devid" })), 403);
  } finally {
    Reflect.deleteProperty(process.env, "NORTHSTAR_EXTRA_ORIGINS");
  }
});

test("OPTIONS preflight needs an extension origin and no token", async () => {
  const ok = await call("OPTIONS", "/comments", {
    Host: host(),
    Origin: ext,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "x-northstar-token",
  });
  assert.equal(ok.status, 204);
  assert.match(String(ok.headers["access-control-allow-headers"]), /x-northstar-token/i);
  assertApiError(
    await call("OPTIONS", "/comments", { Host: host(), Origin: "http://evil.test" }),
    403,
  );
  assertApiError(await call("OPTIONS", "/comments", { Host: host() }), 403);
});

test("/status carries notices, terminal and the last poll without the token leaking elsewhere", async () => {
  const res = await call("GET", "/status", authed());
  assert.equal(res.status, 200);
  const body = parse(res);
  assert.ok(Array.isArray(body.notices));
  assert.equal(body.terminal.driver, "tmux");
  assert.equal(body.lastPolledAt, null);
  assert.ok(!res.body.includes(token));
});

test("a protocol header that differs is a 426 naming the side to update", async () => {
  const older = await call("GET", "/status", authed({ [PROTOCOL_HEADER]: "2" }));
  assertApiError(older, 426);
  assert.equal(parse(older).fix, "Update the Northstar extension.");
  const newer = await call("GET", "/status", authed({ [PROTOCOL_HEADER]: "4" }));
  assertApiError(newer, 426);
  assert.match(parse(newer).fix, /Update Northstar/);
  assert.equal((await call("GET", "/status", authed({ [PROTOCOL_HEADER]: "3" }))).status, 200);
});

test("POST /comments answers 201 before the handoff finishes and /status reports its outcome", async () => {
  let release: () => void = () => {};
  handoff.gate = new Promise((resolve) => {
    release = resolve;
  });
  const before = handoff.sends;
  const res = await post([draft({ cid: "fast-1" })]);
  assert.equal(res.status, 201);
  const body = parse(res);
  assert.equal(body.accepted[0].cid, "fast-1");
  assert.equal(body.typed, false);
  assert.equal(body.ids.length, 1);
  assert.equal(handoff.sends, before + 1);

  handoff.gate = null;
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const status = parse(await call("GET", "/status", authed()));
  assert.equal(status.handoff.typed, true);
  assert.equal(status.handoff.driver, "tmux");
});

test("a handoff that throws is logged and recorded, never unhandled", async () => {
  handoff.send = async () => {
    throw new Error("terminal exploded");
  };
  const res = await post([draft()]);
  assert.equal(res.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(logs.some((l) => l.includes("terminal exploded")));
  const status = parse(await call("GET", "/status", authed()));
  assert.equal(status.handoff.reason, "terminal exploded");
  handoff.send = FakeHandoff.prototype.send.bind(handoff);
});

test("a multi-comment batch is one request and one handoff", async () => {
  const sends = handoff.sends;
  const res = await post([draft(), draft({ comment: "and this" }), draft({ comment: "third" })]);
  assert.equal(res.status, 201);
  assert.equal(parse(res).ids.length, 3);
  assert.equal(handoff.sends, sends + 1);
});

test("a body that is not a list of comments is a 400", async () => {
  assertApiError(await call("POST", "/comments", jsonHeaders(), "{ not json"), 400);
  assertApiError(await post(draft()), 400);
  assertApiError(await post([]), 400);
  assertApiError(await post(Array.from({ length: 201 }, () => draft())), 400);
});

test("a draft without a cid is rejected with the field named", async () => {
  const { cid: _cid, ...noCid } = draft();
  const res = await post([noCid]);
  assertApiError(res, 400);
  const body = parse(res);
  assert.equal(body.rejected[0].field, "cid");
  assert.ok(body.rejected[0].fix);
  assert.deepEqual(body.accepted, []);
});

test("a batch is accepted or rejected per item with a reason, nothing is clipped or stripped", async () => {
  const sends = handoff.sends;
  const res = await post([
    draft({ cid: "good-1" }),
    { cid: "bad-1", comment: "missing everything" },
    draft({ cid: "bad-2", comment: "x".repeat(8_001) }),
    draft({ cid: "good-2", comment: "second" }),
  ]);
  assert.equal(res.status, 201);
  const body = parse(res);
  assert.deepEqual(
    body.accepted.map((a: { cid: string }) => a.cid),
    ["good-1", "good-2"],
  );
  assert.deepEqual(
    body.rejected.map((r: { cid: string }) => r.cid),
    ["bad-1", "bad-2"],
  );
  assert.equal(body.rejected[1].field, "comment");
  assert.match(body.rejected[1].error, /at most 8000/);
  assert.equal(handoff.sends, sends + 1);
});

test("source paths outside the project are rejected naming source.path, inside ones are accepted", async () => {
  for (const path of ["../../etc/passwd", "/etc/passwd", "~/x.ts"]) {
    const res = await post([draft({ source: { path, line: 1, column: 0, via: "x" } })]);
    assertApiError(res, 400);
    assert.equal(parse(res).rejected[0].field, "source.path");
  }
  const inside = await post([
    draft({ source: { path: join(root, "src", "App.tsx"), line: 1, column: 0, via: "x" } }),
  ]);
  assert.equal(inside.status, 201);
  const stored = parse(await call("GET", "/state", authed())).comments.find(
    (c: { id: string }) => c.id === parse(inside).ids[0],
  );
  assert.equal(stored.source.path, "src/App.tsx");
});

test("an unknown field and a non finite number are rejected", async () => {
  const unknown = await post([{ ...draft(), extra: 1 }]);
  assert.match(parse(unknown).rejected[0].error, /unknown keys extra/);
  const nan = await call(
    "POST",
    "/comments",
    jsonHeaders(),
    JSON.stringify([
      draft({ metadata: { page: "/", viewport: { w: 1, h: 1 }, elementText: "" } }),
    ]).replace('"w":1', '"w":1e999'),
  );
  assert.equal(nan.status, 400);
  assert.equal(parse(nan).rejected[0].field, "metadata.viewport.w");
});

test("a repeated cid is stored once and does not trigger another handoff", async () => {
  const payload = [draft({ cid: "dup-1" })];
  const first = parse(await post(payload));
  const sends = handoff.sends;
  const second = parse(await post(payload));
  assert.equal(second.accepted[0].id, first.accepted[0].id);
  assert.equal(handoff.sends, sends);
  const state = parse(await call("GET", "/state", authed()));
  assert.equal(state.comments.filter((c: { cid?: string }) => c.cid === "dup-1").length, 1);
});

test("an oversize body is a 413 with a fix", async () => {
  const res = await call("POST", "/comments", jsonHeaders(), `[${"x".repeat(13 * 1024 * 1024)}]`);
  assertApiError(res, 413);
});

test("GET /comments needs a page and returns only that page's comments", async () => {
  assertApiError(await call("GET", "/comments", authed()), 400);
  assertApiError(await call("GET", "/comments?page=not%20a%20url", authed()), 400);
  await call("DELETE", "/comments?all=true", authed());
  await post([
    draft({ url: "http://localhost:3000/users/1?tab=x" }),
    draft({ url: "http://localhost:3000/users/1/" }),
    draft({ url: "http://localhost:3000/users/2" }),
  ]);
  const one = parse(
    await call(
      "GET",
      `/comments?page=${encodeURIComponent("http://localhost:3000/users/1")}`,
      authed(),
    ),
  );
  assert.equal(one.length, 2);
  const none = parse(await call("GET", `/comments?page=${PAGE}`, authed()));
  assert.equal(none.length, 0);
});

test("DELETE /comments needs exactly one of page and all", async () => {
  assertApiError(await call("DELETE", "/comments", authed()), 400);
  assertApiError(await call("DELETE", `/comments?page=${PAGE}&all=true`, authed()), 400);
  const page = await call(
    "DELETE",
    `/comments?page=${encodeURIComponent("http://localhost:3000/users/1")}`,
    authed(),
  );
  assert.equal(parse(page).removed, 2);
  const rest = await call("DELETE", "/comments?all=true", authed());
  assert.equal(parse(rest).removed, 1);
});

test("GET /state returns version, comments, notices and terminal status", async () => {
  const body = parse(await call("GET", "/state", authed()));
  assert.equal(typeof body.version, "number");
  assert.ok(Array.isArray(body.comments));
  assert.ok(Array.isArray(body.notices));
  assert.equal(body.terminal.available, true);
});

test("reopen validates, 404s unknown ids and 409s an already open comment", async () => {
  const { ids } = parse(await post([draft()]));
  assertApiError(
    await call("POST", "/comments/reopen", jsonHeaders(), JSON.stringify({ note: "x" })),
    400,
  );
  assertApiError(
    await call(
      "POST",
      "/comments/reopen",
      jsonHeaders(),
      JSON.stringify({ id: ids[0], note: "n".repeat(2001) }),
    ),
    400,
  );
  assertApiError(
    await call("POST", "/comments/reopen", jsonHeaders(), JSON.stringify({ id: "nope" })),
    404,
  );
  assertApiError(
    await call("POST", "/comments/reopen", jsonHeaders(), JSON.stringify({ id: ids[0] })),
    409,
  );

  await new CommentStore(root).setStatus(ids[0], "resolved");
  const ok = await call(
    "POST",
    "/comments/reopen",
    jsonHeaders(),
    JSON.stringify({ id: ids[0], note: "more" }),
  );
  assert.equal(ok.status, 200);
});

test("notices can be dismissed and a missing commentId is a 400", async () => {
  server.broker.pushNotice({
    commentId: "c1",
    page: "/",
    summary: "s",
    createdAt: new Date().toISOString(),
  });
  const res = await call(
    "POST",
    "/notices/dismiss",
    jsonHeaders(),
    JSON.stringify({ commentId: "c1" }),
  );
  assert.equal(res.status, 200);
  assert.equal(server.broker.pendingNotices.length, 0);
  assertApiError(await call("POST", "/notices/dismiss", jsonHeaders(), JSON.stringify({})), 400);
});

test("unknown routes are a JSON 404 once the token checks pass", async () => {
  assertApiError(await call("GET", "/no-such-route", authed()), 404);
  for (const path of ["/ping", "/wait", "/ratings", "/handshake"]) {
    assert.equal((await call("GET", path, authed())).status, 404);
  }
});

test("an internal failure is a 500 JSON error and is logged with its stack", async () => {
  const broken = await startIngestServer(
    new BrokenStore(root),
    [0],
    (m) => logs.push(m),
    new Broker(),
    handoff,
    { home },
  );
  const res = await call(
    "GET",
    `/comments?page=${PAGE}`,
    { Host: host(broken), Origin: ext, [TOKEN_HEADER]: token },
    undefined,
    broken,
  );
  assertApiError(res, 500);
  assert.ok(logs.some((l) => l.includes("disk exploded") && l.includes("internal error")));
  await broken.close();
});

test("pairing serves a page, hands the token out once and burns the nonce", async () => {
  const page = await call("GET", "/pair", { Host: host() });
  assert.equal(page.status, 200);
  assert.match(String(page.headers["content-type"]), /text\/html/);
  assert.match(String(page.headers["x-frame-options"]), /DENY/);
  assert.match(String(page.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.ok(page.body.includes(root.split("/").pop() as string));
  assert.ok(page.body.includes("Allow"));
  assert.ok(!page.body.includes(token));
  const nonce = /"nonce":"([0-9a-f]+)"/.exec(page.body)?.[1] as string;
  assert.ok(nonce);

  const sameOrigin = {
    Host: host(),
    Origin: `http://${host()}`,
    "Content-Type": "application/json",
  };
  const bad = await call("POST", "/pair/confirm", sameOrigin, JSON.stringify({ nonce: "wrong" }));
  assertApiError(bad, 403);
  const ok = await call("POST", "/pair/confirm", sameOrigin, JSON.stringify({ nonce }));
  assert.equal(ok.status, 200);
  assert.equal(parse(ok).token, token);
  assertApiError(await call("POST", "/pair/confirm", sameOrigin, JSON.stringify({ nonce })), 403);
});

test("pair confirm refuses cross origin callers and works with Sec-Fetch-Site", async () => {
  const body = async () => {
    const page = await call("GET", "/pair", { Host: host() });
    return JSON.stringify({ nonce: /"nonce":"([0-9a-f]+)"/.exec(page.body)?.[1] });
  };
  const evil = { Host: host(), Origin: "http://evil.test", "Content-Type": "application/json" };
  assertApiError(await call("POST", "/pair/confirm", evil, await body()), 403);
  const none = { Host: host(), "Content-Type": "application/json" };
  assertApiError(await call("POST", "/pair/confirm", none, await body()), 403);
  const fetchSite = { ...none, "Sec-Fetch-Site": "same-origin" };
  assert.equal((await call("POST", "/pair/confirm", fetchSite, await body())).status, 200);
  assertApiError(await call("GET", "/pair", { Host: host(), Origin: "http://evil.test" }), 403);
});

test("each pair page load gets its own nonce", async () => {
  const a = await call("GET", "/pair", { Host: host() });
  const b = await call("GET", "/pair", { Host: host() });
  const nonce = (r: Reply) => /"nonce":"([0-9a-f]+)"/.exec(r.body)?.[1];
  assert.notEqual(nonce(a), nonce(b));
});
