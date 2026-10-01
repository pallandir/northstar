import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Broker } from "../src/broker.js";
import { type IngestServer, startIngestServer } from "../src/http.js";
import { CommentStore } from "../src/store.js";
import type { Handoff, HandoffResult, TerminalStatus } from "../src/terminal/index.js";

let server: IngestServer;
let root: string;

class FakeHandoff implements Handoff {
  sends = 0;
  result: HandoffResult = { typed: true, driver: "tmux" };

  async describe(): Promise<TerminalStatus> {
    return { available: true, driver: "tmux" };
  }

  async send(): Promise<HandoffResult> {
    this.sends += 1;
    return this.result;
  }
}

let handoff: FakeHandoff;

function comment(overrides: Record<string, unknown> = {}) {
  return {
    comment: "tweak this",
    operation: { type: "comment", property: null, from: null, to: null },
    operator: "/html/body/main[1]",
    url: "http://localhost:3000/",
    metadata: { page: "/", viewport: { w: 800, h: 600 }, elementText: "hi" },
    ...overrides,
  };
}

const validBody = JSON.stringify([comment()]);

interface Reply {
  status: number;
  body: string;
}

function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: server.port, method, path, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const ext = "chrome-extension://mmpgoabhnlkcgboiiaebeahcbbeeaggb";
function loopbackHost(): string {
  return `127.0.0.1:${server.port}`;
}
function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { Host: loopbackHost(), Origin: ext, ...extra };
}
function jsonHeaders(): Record<string, string> {
  return headers({ "Content-Type": "application/json" });
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-http-"));
  handoff = new FakeHandoff();
  server = await startIngestServer(new CommentStore(root), [0], () => {}, new Broker(), handoff);
});

after(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

test("/health identifies the service to the extension", async () => {
  const res = await call("GET", "/health", headers());
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.service, "northstar");
  assert.equal(body.root, root);
  assert.equal(typeof body.startedAt, "string");
  assert.equal(typeof body.pid, "number");
});

test("/health reports whether the terminal handoff is available", async () => {
  const res = await call("GET", "/health", headers());
  const body = JSON.parse(res.body);
  assert.equal(body.terminal.available, true);
  assert.equal(body.terminal.driver, "tmux");
});

test("rejects a web-page origin (CSRF / prompt-injection channel)", async () => {
  const res = await call(
    "POST",
    "/comments",
    { Host: loopbackHost(), Origin: "http://evil.test", "Content-Type": "application/json" },
    validBody,
  );
  assert.equal(res.status, 403);
});

test("rejects a non-loopback Host header (DNS rebinding)", async () => {
  const res = await call("GET", "/comments", { Host: "attacker.test", Origin: ext });
  assert.equal(res.status, 403);
});

test("accepts a batch from the extension origin and reports the handoff", async () => {
  const before = handoff.sends;
  const res = await call("POST", "/comments", jsonHeaders(), validBody);
  assert.equal(res.status, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.ids.length, 1);
  assert.equal(body.typed, true);
  assert.equal(handoff.sends, before + 1);
});

test("a multi-comment batch is one request and one handoff", async () => {
  const before = handoff.sends;
  const res = await call(
    "POST",
    "/comments",
    jsonHeaders(),
    JSON.stringify([comment(), comment({ comment: "and this" }), comment({ comment: "third" })]),
  );
  assert.equal(res.status, 201);
  assert.equal(JSON.parse(res.body).ids.length, 3);
  assert.equal(handoff.sends, before + 1);
});

test("a bare object is accepted as a one-item batch", async () => {
  const res = await call("POST", "/comments", jsonHeaders(), JSON.stringify(comment()));
  assert.equal(res.status, 201);
  assert.equal(JSON.parse(res.body).ids.length, 1);
});

test("a failed handoff still stores the batch and reports the reason", async () => {
  handoff.result = { typed: false, reason: "no supported terminal detected" };
  const res = await call("POST", "/comments", jsonHeaders(), validBody);
  assert.equal(res.status, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.typed, false);
  assert.equal(body.reason, "no supported terminal detected");
  assert.equal(body.ids.length, 1);
  handoff.result = { typed: true, driver: "tmux" };
});

test("rejects a malformed payload with 400 and stays up", async () => {
  const res = await call("POST", "/comments", jsonHeaders(), "{ not json");
  assert.equal(res.status, 400);
  const health = await call("GET", "/health", headers());
  assert.equal(health.status, 200);
});

test("rejects a comment missing required fields", async () => {
  const res = await call(
    "POST",
    "/comments",
    jsonHeaders(),
    JSON.stringify([{ comment: "no operator or metadata" }]),
  );
  assert.equal(res.status, 400);
});

test("a bad payload never reaches the terminal", async () => {
  const before = handoff.sends;
  await call("POST", "/comments", jsonHeaders(), "{ not json");
  assert.equal(handoff.sends, before);
});

test("an empty batch is rejected", async () => {
  const res = await call("POST", "/comments", jsonHeaders(), "[]");
  assert.equal(res.status, 400);
});

test("DELETE /comments without url or all=true returns 400", async () => {
  const res = await call("DELETE", "/comments", headers());
  assert.equal(res.status, 400);
});

test("DELETE /comments?all=true clears all comments", async () => {
  await call("POST", "/comments", jsonHeaders(), validBody);
  const res = await call("DELETE", "/comments?all=true", headers());
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).removed >= 0, true);
});

test("DELETE /comments?url= clears only the matching url", async () => {
  const url = encodeURIComponent("http://localhost:3000/");
  const res = await call("DELETE", `/comments?url=${url}`, headers());
  assert.equal(res.status, 200);
});

test("unknown route returns 404", async () => {
  const res = await call("GET", "/no-such-route", headers());
  assert.equal(res.status, 404);
});

test("the removed watch and auth routes are gone", async () => {
  for (const path of ["/ping", "/wait", "/ratings", "/handshake"]) {
    const res = await call("GET", path, headers());
    assert.equal(res.status, 404, `${path} should be gone`);
  }
});

test("OPTIONS preflight returns 204", async () => {
  const res = await call(
    "OPTIONS",
    "/comments",
    headers({ "Access-Control-Request-Method": "POST" }),
  );
  assert.equal(res.status, 204);
});

test("null Origin (sandboxed iframe or data: page) is rejected", async () => {
  const res = await call("GET", "/health", { Host: loopbackHost(), Origin: "null" });
  assert.equal(res.status, 403);
});

test("absent Origin is allowed only for GET /health", async () => {
  const health = await call("GET", "/health", { Host: loopbackHost() });
  assert.equal(health.status, 200);
  const state = await call("GET", "/state", { Host: loopbackHost() });
  assert.equal(state.status, 403);
  const post = await call(
    "POST",
    "/comments",
    { Host: loopbackHost(), "Content-Type": "application/json" },
    validBody,
  );
  assert.equal(post.status, 403);
});

test("a moz-extension origin is allowed so Firefox can reach the server", async () => {
  const res = await call("GET", "/state", { Host: loopbackHost(), Origin: "moz-extension://abc" });
  assert.equal(res.status, 200);
});

test("an unlisted chrome-extension origin is rejected", async () => {
  const res = await call("GET", "/state", {
    Host: loopbackHost(),
    Origin: "chrome-extension://someotherextensionid",
  });
  assert.equal(res.status, 403);
});

test("NORTHSTAR_EXTRA_ORIGINS adds chrome extension ids", async () => {
  const previous = process.env.NORTHSTAR_EXTRA_ORIGINS;
  process.env.NORTHSTAR_EXTRA_ORIGINS = "devidone, devidtwo";
  try {
    const res = await call("GET", "/state", {
      Host: loopbackHost(),
      Origin: "chrome-extension://devidtwo",
    });
    assert.equal(res.status, 200);
  } finally {
    Reflect.deleteProperty(process.env, "NORTHSTAR_EXTRA_ORIGINS");
    if (previous !== undefined) process.env.NORTHSTAR_EXTRA_ORIGINS = previous;
  }
});

test("/health keeps reporting the server version", async () => {
  const res = await call("GET", "/health", headers());
  assert.equal(typeof JSON.parse(res.body).version, "number");
});

test("a batch is accepted or rejected per item", async () => {
  const before = handoff.sends;
  const res = await call(
    "POST",
    "/comments",
    jsonHeaders(),
    JSON.stringify([
      comment({ cid: "good-1" }),
      { cid: "bad-1", comment: "missing everything" },
      comment({ cid: "good-2", comment: "second" }),
    ]),
  );
  assert.equal(res.status, 201);
  const body = JSON.parse(res.body);
  assert.deepEqual(
    body.accepted.map((a: { cid: string }) => a.cid),
    ["good-1", "good-2"],
  );
  assert.equal(body.rejected.length, 1);
  assert.equal(body.rejected[0].cid, "bad-1");
  assert.equal(typeof body.rejected[0].reason, "string");
  assert.equal(body.ids.length, 2);
  assert.equal(body.typed, true);
  assert.equal(handoff.sends, before + 1);
});

test("a batch where every item is bad is a 400 that still lists the reasons", async () => {
  const res = await call("POST", "/comments", jsonHeaders(), JSON.stringify([{ cid: "x" }]));
  assert.equal(res.status, 400);
  assert.equal(JSON.parse(res.body).rejected[0].cid, "x");
});

test("a repeated cid is stored once and does not trigger another handoff", async () => {
  const payload = JSON.stringify([comment({ cid: "dup-1" })]);
  const first = JSON.parse((await call("POST", "/comments", jsonHeaders(), payload)).body);
  const sends = handoff.sends;
  const second = JSON.parse((await call("POST", "/comments", jsonHeaders(), payload)).body);
  assert.equal(second.accepted[0].id, first.accepted[0].id);
  assert.equal(handoff.sends, sends);

  const state = JSON.parse((await call("GET", "/state", headers())).body);
  const matches = state.comments.filter((c: { cid?: string }) => c.cid === "dup-1");
  assert.equal(matches.length, 1);
});

test("a v1 payload and a v2 payload both ingest", async () => {
  const v2 = comment({
    cid: "v2-1",
    schemaVersion: 2,
    intent: "copy",
    locate: [
      { kind: "testId", value: "hero", confidence: 0.9 },
      { kind: "text", value: "Buy now", confidence: "medium" },
    ],
    page: { title: "Home", colorScheme: "dark" },
    element: { ariaRole: "button", ariaName: "Buy now", landmark: "main", heading: "Pricing" },
  });
  const res = await call("POST", "/comments", jsonHeaders(), JSON.stringify([comment(), v2]));
  assert.equal(res.status, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.accepted.length, 2);
  const state = JSON.parse((await call("GET", "/state", headers())).body);
  const stored = state.comments.find((c: { cid?: string }) => c.cid === "v2-1");
  assert.equal(stored.intent, "copy");
  assert.equal(stored.locate[0].value, "hero");
  assert.equal(stored.page.colorScheme, "dark");
  assert.equal(stored.element.heading, "Pricing");
});

test("oversized or malformed values are coerced instead of rejected", async () => {
  const item = comment({
    comment: "x".repeat(20_000),
    metadata: { page: "/", viewport: { w: Number.NaN, h: 600 }, elementText: "hi" },
    route: {
      pattern: "/a",
      params: { id: ["1", "2"] },
      router: "next",
      routeFile: null,
      confidence: "exact",
    },
  });
  const res = await call("POST", "/comments", jsonHeaders(), JSON.stringify([item]));
  assert.equal(res.status, 201);
  const state = JSON.parse((await call("GET", "/state", headers())).body);
  const stored = state.comments.find(
    (c: { id: string }) => c.id === JSON.parse(res.body).accepted[0].id,
  );
  assert.equal(stored.comment.length, 8000);
  assert.equal(stored.route.params.id, "1,2");
  assert.equal(stored.metadata.viewport.w, 0);
});

test("GET /state returns version, comments, notices and terminal status", async () => {
  const res = await call("GET", "/state", headers());
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(typeof body.version, "number");
  assert.ok(Array.isArray(body.comments));
  assert.ok(Array.isArray(body.notices));
  assert.equal(body.terminal.available, true);
});

test("POST /comments/reopen reopens a resolved comment", async () => {
  const post = await call("POST", "/comments", jsonHeaders(), validBody);
  const { ids } = JSON.parse(post.body);
  const res = await call("POST", "/comments/reopen", jsonHeaders(), JSON.stringify({ id: ids[0] }));
  assert.equal(res.status, 200);
});

test("POST /comments/reopen returns 400 when id is missing", async () => {
  const res = await call(
    "POST",
    "/comments/reopen",
    jsonHeaders(),
    JSON.stringify({ note: "no id here" }),
  );
  assert.equal(res.status, 400);
});

test("POST /comments/reopen returns 404 for an unknown id", async () => {
  const res = await call(
    "POST",
    "/comments/reopen",
    jsonHeaders(),
    JSON.stringify({ id: "no-such-id" }),
  );
  assert.equal(res.status, 404);
});

test("POST /notices/dismiss removes the notice from the broker", async () => {
  server.broker.pushNotice({
    commentId: "c1",
    page: "/",
    summary: "test notice",
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
});

test("POST /notices/dismiss returns 400 when commentId is missing", async () => {
  const res = await call("POST", "/notices/dismiss", jsonHeaders(), JSON.stringify({}));
  assert.equal(res.status, 400);
});

test("source.path with traversal segments is rejected with 400", async () => {
  const body = JSON.stringify([
    comment({
      source: { path: "../../etc/passwd", line: 1, column: 0, via: "react-dev-inspector" },
    }),
  ]);
  const res = await call("POST", "/comments", jsonHeaders(), body);
  assert.equal(res.status, 400);
});

test("a batch carrying component, route and target round-trips through GET /state", async () => {
  const body = JSON.stringify([
    comment({
      source: { path: "src/App.tsx", line: 12, column: 3, via: "react-fiber" },
      component: { stack: [{ name: "TrafficSources" }, { name: "DashboardPage" }] },
      route: {
        pattern: "/users/:id",
        params: { id: "8123" },
        router: "react-router",
        routeFile: "app/routes/users.$id.tsx",
        confidence: "exact",
      },
      target: {
        selector: '[data-testid="traffic"] > article.card',
        tag: "article",
        id: null,
        testId: "traffic",
        role: null,
        ariaLabel: null,
        classes: ["card"],
        attributes: {},
        ownText: "Traffic sources",
        ancestors: [{ tag: "section", id: "dashboard", classes: [] }],
        rect: { x: 0, y: 0, w: 100, h: 40 },
        outerHtml: '<article class="card">Traffic sources</article>',
      },
      attachScreenshot: true,
    }),
  ]);
  const post = await call("POST", "/comments", jsonHeaders(), body);
  assert.equal(post.status, 201);
  const postedId = JSON.parse(post.body).ids[0];

  const state = await call("GET", "/state", headers());
  const stored = JSON.parse(state.body).comments.find((c: { id: string }) => c.id === postedId);
  assert.ok(stored, "posted comment should be present in /state");
  assert.equal(stored.component.stack[0].name, "TrafficSources");
  assert.equal(stored.route.pattern, "/users/:id");
  assert.equal(stored.route.confidence, "exact");
  assert.equal(stored.target.selector, '[data-testid="traffic"] > article.card');
  assert.equal(stored.attachScreenshot, true);
});

test("rejects a target payload with an unknown field (strict schema)", async () => {
  const body = JSON.stringify([
    comment({
      target: {
        selector: "div",
        tag: "div",
        id: null,
        testId: null,
        role: null,
        ariaLabel: null,
        classes: [],
        attributes: {},
        ownText: "",
        ancestors: [],
        rect: { x: 0, y: 0, w: 0, h: 0 },
        outerHtml: "<div></div>",
        extra: "not allowed",
      },
    }),
  ]);
  const res = await call("POST", "/comments", jsonHeaders(), body);
  assert.equal(res.status, 400);
});
