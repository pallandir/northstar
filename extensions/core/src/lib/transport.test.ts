import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLocalUrl } from "./origins.js";

describe("isLocalUrl", () => {
  it.each([
    ["http://localhost:3000/", true],
    ["http://127.0.0.1:8080/path", true],
    ["http://myapp.localhost/", true],
    ["http://a.b.localhost/", true],
    ["http://[::1]/", true],
    ["https://example.com/", false],
    ["https://notlocalhost/", false],
    ["", false],
    ["not a url", false],
    ["file:///etc/passwd", false],
  ])("%s is %s", (url, expected) => {
    expect(isLocalUrl(url)).toBe(expected);
  });
});

const storage = (globalThis as unknown as { __northstarStorage: { local: Map<string, unknown> } })
  .__northstarStorage.local;

const ORIGIN = "http://localhost:3000";
const AGENT = { ready: true, agent: "codex", via: "terminal", driver: "tmux" };
const TOKEN = "a".repeat(64);

const draft = (comment: string, url = `${ORIGIN}/`) => ({
  comment,
  operation: { type: "comment" as const, property: null, from: null, to: null },
  operator: "/html/body",
  url,
  metadata: { page: "/", viewport: { w: 800, h: 600 }, elementText: "" },
  source: null,
  component: null,
  route: null,
  target: null,
  screenshotDataUrl: null,
  attachScreenshot: false,
  planFirst: false,
});

const health = (protocol = 4) => ({
  ok: true,
  service: "northstar",
  protocol,
  root: "/work/shop",
  startedAt: "2026-01-01T00:00:00.000Z",
  version: "2.3.0",
  paired: false,
});

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function reply(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function stubServer(handler: (path: string, call: Call) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    if (new URL(url).port !== "7474") throw new Error("connection refused");
    if (path === "/health") return reply(200, health());
    const answered = handler(path, call);
    if (answered) return answered;
    throw new Error(`unexpected request ${call.method} ${path}`);
  });
  return calls;
}

function stubClosedPorts() {
  vi.stubGlobal("fetch", async () => {
    throw new Error("connection refused");
  });
}

beforeEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("flush", () => {
  it("sends only the sender origin and drops what the server accepted", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    const first = await mod.saveDraft(ORIGIN, draft("first"));
    await mod.saveDraft("http://localhost:5173", draft("elsewhere", "http://localhost:5173/"));

    const calls = stubServer((path, call) => {
      if (path === "/comments" && call.method === "POST") {
        return reply(201, {
          ids: ["c-1"],
          accepted: [{ cid: first.cid, id: "c-1" }],
          rejected: [],
        });
      }
      if (path === "/status") {
        return reply(200, {
          notices: [],
          agent: AGENT,
          open: 0,
          lastPolledAt: null,
        });
      }
      return undefined;
    });
    const result = await mod.flush(ORIGIN);

    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].headers["x-northstar-token"]).toBe(TOKEN);
    expect(posts[0].body).toHaveLength(1);
    expect(result.send).toMatchObject({ sent: 1, rejected: 0 });
    expect(result.status.queued).toBe(0);
    expect((await mod.status("http://localhost:5173")).queued).toBe(1);
  });

  it("keeps a rejected comment with the server's reason", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    const good = await mod.saveDraft(ORIGIN, draft("good"));
    const bad = await mod.saveDraft(ORIGIN, draft("bad"));

    stubServer((path, call) => {
      if (path === "/comments" && call.method === "POST") {
        return reply(201, {
          ids: ["c-1"],
          accepted: [{ cid: good.cid, id: "c-1" }],
          rejected: [
            {
              cid: bad.cid,
              field: "source.path",
              error: "The source.path field is unsafe.",
              fix: "Pick the element again.",
            },
          ],
        });
      }
      if (path === "/status") {
        return reply(200, {
          notices: [],
          agent: AGENT,
          open: 0,
          lastPolledAt: null,
          handoff: null,
        });
      }
      return undefined;
    });
    const result = await mod.flush(ORIGIN);

    expect(result.send.rejected).toBe(1);
    expect(result.status).toMatchObject({ queued: 0, failed: 1 });
    const kept = await mod.queuedForPage(ORIGIN, `${ORIGIN}/`);
    expect(kept).toHaveLength(1);
    expect(kept[0].rejection).toMatchObject({
      field: "source.path",
      fix: "Pick the element again.",
    });
  });

  it("keeps every comment when the whole batch is rejected", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    const a = await mod.saveDraft(ORIGIN, draft("a"));
    const b = await mod.saveDraft(ORIGIN, draft("b"));

    stubServer((path, call) => {
      if (path === "/comments" && call.method === "POST") {
        return reply(400, {
          error: "Nothing was accepted.",
          fix: "Fix the comments and send again.",
          rejected: [
            {
              cid: a.cid,
              field: "comment",
              error: "The comment field is empty.",
              fix: "Write something.",
            },
            {
              cid: b.cid,
              field: "operator",
              error: "The operator field is invalid.",
              fix: "Pick the element again.",
            },
          ],
        });
      }
      if (path === "/status") {
        return reply(200, {
          notices: [],
          agent: AGENT,
          open: 0,
          lastPolledAt: null,
          handoff: null,
        });
      }
      return undefined;
    });
    const result = await mod.flush(ORIGIN);

    expect(result.status.failed).toBe(2);
    expect(result.send).toMatchObject({ sent: 0, rejected: 2 });
    expect(await mod.queuedForPage(ORIGIN, `${ORIGIN}/`)).toHaveLength(2);
  });

  it("fails loudly and keeps the queue when no server runs", async () => {
    const mod = await import("./transport.js");
    await mod.saveDraft(ORIGIN, draft("kept"));
    stubClosedPorts();

    await expect(mod.flush(ORIGIN)).rejects.toMatchObject({
      message: "No Northstar server is running.",
      kind: "offline",
    });
    expect((await mod.status(ORIGIN)).queued).toBe(1);
  });

  it("asks to connect when no token is stored", async () => {
    const mod = await import("./transport.js");
    await mod.saveDraft(ORIGIN, draft("kept"));
    stubServer(() => undefined);

    await expect(mod.flush(ORIGIN)).rejects.toMatchObject({ kind: "unpaired" });
    expect((await mod.status(ORIGIN)).connection).toBe("unpaired");
  });

  it("clears the token when the server answers 401", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    await mod.saveDraft(ORIGIN, draft("kept"));
    stubServer((path) =>
      path === "/comments"
        ? reply(401, {
            error: "This browser is not connected to Northstar.",
            fix: "Click Connect in the Northstar toolbar.",
          })
        : undefined,
    );

    await expect(mod.flush(ORIGIN)).rejects.toMatchObject({ kind: "unpaired" });
    expect(storage.has("northstar-token")).toBe(false);
    expect((await mod.status(ORIGIN)).queued).toBe(1);
  });

  it("refuses a server speaking another protocol and names the side to update", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    vi.stubGlobal("fetch", async (url: string) => {
      if (new URL(url).port !== "7474") throw new Error("connection refused");
      return reply(200, health(2));
    });

    const status = await mod.status(ORIGIN);
    expect(status.connection).toBe("mismatch");
    expect(status.problem?.fix).toBe("Update the Northstar server, then restart your AI agent.");
  });

  it("sends no request when there is nothing to send", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    const calls = stubServer((path) =>
      path === "/status"
        ? reply(200, {
            notices: [],
            agent: AGENT,
            open: 0,
            lastPolledAt: null,
            handoff: null,
          })
        : undefined,
    );
    const result = await mod.flush(ORIGIN);

    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(result.send).toEqual({ sent: 0, rejected: 0 });
  });

  it("does not send a comment twice while a send is in flight", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    const item = await mod.saveDraft(ORIGIN, draft("once"));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (new URL(url).port !== "7474") throw new Error("connection refused");
      if (path === "/health") return reply(200, health());
      if (path === "/status")
        return reply(200, {
          notices: [],
          agent: AGENT,
          open: 0,
          lastPolledAt: null,
          handoff: null,
        });
      calls.push(init?.method ?? "GET");
      await gate;
      return reply(201, {
        ids: ["c-1"],
        accepted: [{ cid: item.cid, id: "c-1" }],
        rejected: [],
      });
    });

    const first = mod.flush(ORIGIN);
    const second = mod.flush(ORIGIN);
    release();
    await Promise.all([first, second]);

    expect(calls.filter((m) => m === "POST")).toHaveLength(1);
  });
});

describe("status", () => {
  it("carries the agent readiness through to the toolbar", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    stubServer((path) =>
      path === "/status"
        ? reply(200, {
            notices: [],
            agent: AGENT,
            open: 0,
            lastPolledAt: null,
          })
        : undefined,
    );
    const status = await mod.status(ORIGIN);
    expect(status.connection).toBe("connected");
    expect(status.agent).toEqual(AGENT);
  });

  it("asks which project when more than one server answers", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    vi.stubGlobal("fetch", async (url: string) => {
      const port = new URL(url).port;
      if (port === "7476") throw new Error("refused");
      return reply(200, { ...health(), root: port === "7474" ? "/work/shop" : "/work/blog" });
    });

    const status = await mod.status(ORIGIN);
    expect(status.connection).toBe("choose");
    expect(status.servers).toEqual([
      { port: 7474, project: "shop" },
      { port: 7475, project: "blog" },
    ]);
  });

  it("reports offline for a remote origin without contacting the server", async () => {
    const mod = await import("./transport.js");
    const calls = stubServer(() => undefined);
    const status = await mod.status("https://example.com");
    expect(status.connection).toBe("offline");
    expect(calls).toHaveLength(0);
  });
});

describe("page scoping", () => {
  it("returns only the comments of the requested page", async () => {
    const mod = await import("./transport.js");
    await mod.saveDraft(ORIGIN, draft("home", `${ORIGIN}/`));
    await mod.saveDraft(ORIGIN, draft("user", `${ORIGIN}/users/8123`));

    expect((await mod.queuedForPage(ORIGIN, `${ORIGIN}/`)).map((c) => c.comment)).toEqual(["home"]);
    expect(
      (await mod.queuedForPage(ORIGIN, `${ORIGIN}/users/8123/?tab=a#top`)).map((c) => c.comment),
    ).toEqual(["user"]);
  });

  it("refuses to save a draft taken on another origin", async () => {
    const mod = await import("./transport.js");
    expect(() => mod.saveDraft(ORIGIN, draft("x", "http://localhost:5173/"))).toThrow(
      "The page changed before the comment was saved.",
    );
  });
});

describe("sendToAgent", () => {
  const handoffReply = {
    delivered: true,
    agent: "claude-code",
    via: "channel",
    at: "2026-01-01T00:00:00.000Z",
  };

  it("flushes, then wakes the agent and returns its outcome", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    const item = await mod.saveDraft(ORIGIN, draft("first"));
    let open = 0;
    const calls = stubServer((path, call) => {
      if (path === "/comments" && call.method === "POST") {
        open = 1;
        return reply(201, { ids: ["c-1"], accepted: [{ cid: item.cid, id: "c-1" }], rejected: [] });
      }
      if (path === "/status") {
        return reply(200, { notices: [], agent: AGENT, open, lastPolledAt: null });
      }
      if (path === "/handoff") return reply(200, handoffReply);
      return undefined;
    });
    const { send, status } = await mod.sendToAgent(ORIGIN);
    expect(send.sent).toBe(1);
    expect(send.woke).toMatchObject({ delivered: true, agent: "claude-code" });
    expect(status.queued).toBe(0);
    const order = calls.filter((c) => c.method === "POST").map((c) => new URL(c.url).pathname);
    expect(order).toEqual(["/comments", "/handoff"]);
  });

  it("wakes the agent even when nothing is queued but comments are open on the server", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    const calls = stubServer((path) => {
      if (path === "/status") {
        return reply(200, { notices: [], agent: AGENT, open: 2, lastPolledAt: null });
      }
      if (path === "/handoff") return reply(200, handoffReply);
      return undefined;
    });
    const { send } = await mod.sendToAgent(ORIGIN);
    expect(send.sent).toBe(0);
    expect(send.woke?.delivered).toBe(true);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("does not wake anything when nothing is open", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    const calls = stubServer((path) =>
      path === "/status"
        ? reply(200, { notices: [], agent: AGENT, open: 0, lastPolledAt: null })
        : undefined,
    );
    const { send } = await mod.sendToAgent(ORIGIN);
    expect(send.woke).toBeNull();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("returns a handoff the agent did not pick up with the server's reason and fix", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    stubServer((path) => {
      if (path === "/status") {
        return reply(200, { notices: [], agent: AGENT, open: 1, lastPolledAt: null });
      }
      if (path === "/handoff") {
        return reply(200, {
          ...handoffReply,
          delivered: false,
          reason: "Claude Code did not start on the comments within 20 seconds.",
          fix: "Check Claude Code, then click Send to AI again.",
        });
      }
      return undefined;
    });
    const { send } = await mod.sendToAgent(ORIGIN);
    expect(send.woke).toMatchObject({
      delivered: false,
      fix: "Check Claude Code, then click Send to AI again.",
    });
  });

  it("surfaces a server refusal as an error with its fix", async () => {
    storage.set("northstar-token", TOKEN);
    const mod = await import("./transport.js");
    stubServer((path) => {
      if (path === "/status") {
        return reply(200, { notices: [], agent: AGENT, open: 1, lastPolledAt: null });
      }
      if (path === "/handoff") {
        return reply(409, {
          error: "A send to the agent is already in progress.",
          fix: "Wait for it to finish.",
        });
      }
      return undefined;
    });
    await expect(mod.sendToAgent(ORIGIN)).rejects.toThrow("already in progress");
  });
});

describe("binding to the right project", () => {
  const owns = (matchesByPort: Record<string, number>, depthByPort: Record<string, number> = {}) =>
    stubServerPorts((port, path) => {
      if (path === "/health") {
        return reply(200, { ...health(), root: port === "7474" ? "/work" : "/work/shop" });
      }
      if (path === "/owns") {
        return reply(200, { matches: matchesByPort[port] ?? 0, depth: depthByPort[port] ?? 2 });
      }
      return undefined;
    });

  function stubServerPorts(handler: (port: string, path: string) => Response | undefined) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const u = new URL(url);
      if (!["7474", "7475"].includes(u.port)) throw new Error("refused");
      calls.push(`${u.port}${u.pathname}`);
      const answer = handler(u.port, u.pathname);
      if (!answer) throw new Error(`unexpected ${u.port}${u.pathname}`);
      return answer;
    });
    return calls;
  }

  it("binds to the only server whose root contains the page's source files", async () => {
    storage.set("northstar-token", TOKEN);
    const server = await import("./server.js");
    await server.reportSources(ORIGIN, ["src/App.jsx"]);
    owns({ "7475": 3 });
    const link = await server.resolveLink(ORIGIN);
    expect(link).toMatchObject({ kind: "connected", server: { port: 7475 } });
  });

  it("prefers the deepest root when several roots own the same files", async () => {
    storage.set("northstar-token", TOKEN);
    const server = await import("./server.js");
    await server.reportSources(ORIGIN, ["src/App.jsx"]);
    owns({ "7474": 2, "7475": 2 }, { "7474": 2, "7475": 5 });
    expect(await server.resolveLink(ORIGIN)).toMatchObject({ server: { port: 7475 } });
  });

  it("asks which project only when no root owns the files, and honours that choice", async () => {
    storage.set("northstar-token", TOKEN);
    const server = await import("./server.js");
    await server.reportSources(ORIGIN, ["src/Nowhere.jsx"]);
    owns({});
    expect((await server.resolveLink(ORIGIN)).kind).toBe("choose");
    await server.chooseServer(ORIGIN, 7474);
    expect(await server.resolveLink(ORIGIN)).toMatchObject({
      kind: "connected",
      server: { port: 7474 },
    });
  });

  it("never offers a server on another protocol version", async () => {
    storage.set("northstar-token", TOKEN);
    const server = await import("./server.js");
    stubServerPorts((port, path) =>
      path === "/health" ? reply(200, { ...health(port === "7474" ? 3 : 4) }) : undefined,
    );
    expect(await server.resolveLink(ORIGIN)).toMatchObject({
      kind: "connected",
      server: { port: 7475 },
    });
  });

  it("reports a mismatch when every server is on another version", async () => {
    storage.set("northstar-token", TOKEN);
    const server = await import("./server.js");
    stubServerPorts((_port, path) => (path === "/health" ? reply(200, health(3)) : undefined));
    expect((await server.resolveLink(ORIGIN)).kind).toBe("mismatch");
  });
});
