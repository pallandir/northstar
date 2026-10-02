import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLocalUrl } from "../extensions/core/src/lib/origins.js";
import { type HostCall, HostFailure, installFakeHost, missingHost } from "./ext-native-host.js";

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
const ROOT = "/work/shop";
const PROJECT = { root: ROOT, name: "shop", sessions: 1 };
const SESSION = {
  id: "s1",
  agent: "codex",
  name: "Codex",
  command: "/bin/codex",
  cwd: ROOT,
  root: ROOT,
  pid: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  kind: "interactive",
};
const READY = { ready: true, sessions: [SESSION], target: "s1", needsPick: false };
const CONFIG = { preferredAgent: null, template: "resolve", projects: {} };

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

const statusBody = (open = 0, extra: Record<string, unknown> = {}) => ({
  notices: [],
  readiness: READY,
  open,
  lastPolledAt: null,
  handoff: null,
  ...extra,
});

type Answers = Record<string, (params: Record<string, unknown>) => unknown>;

function host(answers: Answers = {}, projects: unknown[] = [PROJECT]) {
  return installFakeHost((action, params) => {
    if (action === "project.list") return projects;
    if (action === "config.get") return CONFIG;
    if (action === "agent.list") return [];
    const answer = answers[action];
    if (!answer) throw new Error(`unexpected action ${action}`);
    return answer(params);
  });
}

const posted = (calls: HostCall[], action: string) => calls.filter((c) => c.action === action);

beforeEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("flush", () => {
  it("sends only the sender origin and drops what the helper accepted", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    const first = await mod.saveDraft(ORIGIN, draft("first"));
    await mod.saveDraft("http://localhost:5173", draft("elsewhere", "http://localhost:5173/"));

    const fake = host({
      "comments.add": () => ({
        ids: ["c-1"],
        accepted: [{ cid: first.cid, id: "c-1" }],
        rejected: [],
      }),
      "status.get": () => statusBody(),
    });
    const result = await mod.flush(ORIGIN);

    const adds = posted(fake.calls, "comments.add");
    expect(adds).toHaveLength(1);
    expect(adds[0]?.params.root).toBe(ROOT);
    expect(adds[0]?.params.drafts).toHaveLength(1);
    expect(result.send).toMatchObject({ sent: 1, rejected: 0 });
    expect(result.status.queued).toBe(0);
    expect((await mod.status("http://localhost:5173")).queued).toBe(1);
  });

  it("keeps a rejected comment with the helper's reason", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    const good = await mod.saveDraft(ORIGIN, draft("good"));
    const bad = await mod.saveDraft(ORIGIN, draft("bad"));

    host({
      "comments.add": () => ({
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
      }),
      "status.get": () => statusBody(),
    });
    const result = await mod.flush(ORIGIN);

    expect(result.send.rejected).toBe(1);
    expect(result.status).toMatchObject({ queued: 0, failed: 1 });
    const kept = await mod.queuedForPage(ORIGIN, `${ORIGIN}/`);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.rejection).toMatchObject({
      field: "source.path",
      fix: "Pick the element again.",
    });
  });

  it("keeps every comment when the whole batch is rejected", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    const a = await mod.saveDraft(ORIGIN, draft("a"));
    const b = await mod.saveDraft(ORIGIN, draft("b"));

    host({
      "comments.add": () => ({
        ids: [],
        accepted: [],
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
      }),
      "status.get": () => statusBody(),
    });
    const result = await mod.flush(ORIGIN);

    expect(result.status.failed).toBe(2);
    expect(result.send).toMatchObject({
      sent: 0,
      rejected: 2,
      reason: "The comment field is empty.",
    });
    expect(await mod.queuedForPage(ORIGIN, `${ORIGIN}/`)).toHaveLength(2);
  });

  it("fails loudly and keeps the queue when the helper is not installed", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    await mod.saveDraft(ORIGIN, draft("kept"));
    missingHost();

    await expect(mod.flush(ORIGIN)).rejects.toMatchObject({
      message: "Northstar's browser helper is not installed.",
      kind: "offline",
    });
    expect((await mod.status(ORIGIN)).queued).toBe(1);
  });

  it("reports a project that has not started yet and keeps the queue", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    await mod.saveDraft(ORIGIN, draft("kept"));
    host({}, []);

    await expect(mod.flush(ORIGIN)).rejects.toMatchObject({
      message: "No project is running yet.",
      kind: "offline",
    });
    expect((await mod.status(ORIGIN)).connection).toBe("noproject");
  });

  it("names the side to update when the helper speaks another protocol", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    installFakeHost((action) => {
      if (action === "project.list") {
        throw new HostFailure(
          "VERSION_MISMATCH",
          "The extension and the Northstar package versions differ.",
          "Update the Northstar browser extension.",
        );
      }
      return null;
    });

    const status = await mod.status(ORIGIN);
    expect(status.connection).toBe("mismatch");
    expect(status.problem?.fix).toBe("Update the Northstar browser extension.");
  });

  it("sends no request when there is nothing to send", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    const fake = host({ "status.get": () => statusBody() });
    const result = await mod.flush(ORIGIN);

    expect(posted(fake.calls, "comments.add")).toHaveLength(0);
    expect(result.send).toEqual({ sent: 0, rejected: 0 });
  });

  it("does not send a comment twice while a send is in flight", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    const item = await mod.saveDraft(ORIGIN, draft("once"));
    const fake = host({
      "comments.add": () => ({
        ids: ["c-1"],
        accepted: [{ cid: item.cid, id: "c-1" }],
        rejected: [],
      }),
      "status.get": () => statusBody(),
    });

    await Promise.all([mod.flush(ORIGIN), mod.flush(ORIGIN)]);

    expect(posted(fake.calls, "comments.add")).toHaveLength(1);
  });
});

describe("status", () => {
  it("carries the session readiness through to the toolbar", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    host({ "status.get": () => statusBody() });
    const status = await mod.status(ORIGIN);
    expect(status.connection).toBe("connected");
    expect(status.readiness).toEqual(READY);
    expect(status.template).toBe("resolve");
  });

  it("asks which project when more than one is known and nothing binds", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    host(
      { "project.resolve": () => ({ owners: [], mapped: null }), "status.get": () => statusBody() },
      [PROJECT, { root: "/work/blog", name: "blog", sessions: 1 }],
    );

    const status = await mod.status(ORIGIN);
    expect(status.connection).toBe("choose");
    expect(status.projects).toEqual([
      { root: ROOT, project: "shop" },
      { root: "/work/blog", project: "blog" },
    ]);
  });

  it("reports offline for a remote origin without contacting the helper", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    const fake = host();
    const status = await mod.status("https://example.com");
    expect(status.connection).toBe("offline");
    expect(fake.calls).toHaveLength(0);
    expect(fake.connections).toBe(0);
  });
});

describe("page scoping", () => {
  it("returns only the comments of the requested page", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    await mod.saveDraft(ORIGIN, draft("home", `${ORIGIN}/`));
    await mod.saveDraft(ORIGIN, draft("user", `${ORIGIN}/users/8123`));

    expect((await mod.queuedForPage(ORIGIN, `${ORIGIN}/`)).map((c) => c.comment)).toEqual(["home"]);
    expect(
      (await mod.queuedForPage(ORIGIN, `${ORIGIN}/users/8123/?tab=a#top`)).map((c) => c.comment),
    ).toEqual(["user"]);
  });

  it("refuses to save a draft taken on another origin", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    expect(() => mod.saveDraft(ORIGIN, draft("x", "http://localhost:5173/"))).toThrow(
      "The page changed before the comment was saved.",
    );
  });
});

describe("sendToAgent", () => {
  const delivered = {
    delivered: true,
    session: { id: "s1", agent: "claude", name: "Claude Code" },
    at: "2026-01-01T00:00:00.000Z",
  };

  it("flushes, then sends the template and returns the outcome", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    const item = await mod.saveDraft(ORIGIN, draft("first"));
    let open = 0;
    const fake = host({
      "comments.add": () => {
        open = 1;
        return { ids: ["c-1"], accepted: [{ cid: item.cid, id: "c-1" }], rejected: [] };
      },
      "status.get": () => statusBody(open),
      "session.send": () => delivered,
    });
    const { send, status } = await mod.sendToAgent(ORIGIN);
    expect(send.sent).toBe(1);
    expect(send.woke).toMatchObject({ delivered: true, session: { name: "Claude Code" } });
    expect(status.queued).toBe(0);
    const order = fake.calls
      .filter((c) => c.action === "comments.add" || c.action === "session.send")
      .map((c) => c.action);
    expect(order).toEqual(["comments.add", "session.send"]);
    expect(posted(fake.calls, "session.send")[0]?.params).toMatchObject({
      root: ROOT,
      template: "resolve",
    });
  });

  it("sends the chosen session and template", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    const fake = host({ "status.get": () => statusBody(2), "session.send": () => delivered });
    await mod.sendToAgent(ORIGIN, { sessionId: "s2", template: "review" });
    expect(posted(fake.calls, "session.send")[0]?.params).toMatchObject({
      sessionId: "s2",
      template: "review",
    });
  });

  it("sends even when nothing is queued but comments are open", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    const fake = host({ "status.get": () => statusBody(2), "session.send": () => delivered });
    const { send } = await mod.sendToAgent(ORIGIN);
    expect(send.sent).toBe(0);
    expect(send.woke?.delivered).toBe(true);
    expect(posted(fake.calls, "session.send")).toHaveLength(1);
  });

  it("sends nothing when nothing is open", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    const fake = host({ "status.get": () => statusBody(0) });
    const { send } = await mod.sendToAgent(ORIGIN);
    expect(send.woke).toBeNull();
    expect(posted(fake.calls, "session.send")).toHaveLength(0);
  });

  it("returns a blocked delivery with the reason, the block and the fix", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    host({
      "status.get": () => statusBody(1),
      "session.send": () => ({
        delivered: false,
        session: { id: "s1", agent: "claude", name: "Claude Code" },
        blocked: "prompt",
        reason: "Northstar did not write to Claude Code, the agent is waiting on a prompt.",
        fix: "Answer the prompt in the agent, then click Send to AI again.",
        at: "2026-01-01T00:00:00.000Z",
      }),
    });
    const { send } = await mod.sendToAgent(ORIGIN);
    expect(send.woke).toMatchObject({ delivered: false, blocked: "prompt" });
  });

  it("surfaces a refusal as an error with its fix", async () => {
    const mod = await import("../extensions/core/src/lib/transport.js");
    host({
      "status.get": () => statusBody(1),
      "session.send": () => {
        throw new HostFailure(
          "BLOCKED",
          "A send to the agent is already in progress.",
          "Wait for it to finish.",
        );
      },
    });
    await expect(mod.sendToAgent(ORIGIN)).rejects.toMatchObject({
      message: "A send to the agent is already in progress.",
      fix: "Wait for it to finish.",
    });
  });
});

describe("binding to the right project", () => {
  const SHOP = { root: "/work", name: "work", sessions: 1 };
  const BLOG = { root: "/work/shop", name: "shop", sessions: 1 };
  const resolve = (resolution: unknown) =>
    host({ "project.resolve": () => resolution, "status.get": () => statusBody() }, [SHOP, BLOG]);

  it("binds to the only project whose root contains the page's source files", async () => {
    const bridge = await import("../extensions/core/src/lib/bridge.js");
    await bridge.reportSources(ORIGIN, ["src/App.jsx"]);
    resolve({
      owners: [
        { root: "/work", matches: 0, depth: 2 },
        { root: "/work/shop", matches: 3, depth: 3 },
      ],
      mapped: null,
    });
    expect(await bridge.resolveLink(ORIGIN)).toEqual({ kind: "connected", root: "/work/shop" });
  });

  it("prefers the deepest root when several roots own the same files", async () => {
    const bridge = await import("../extensions/core/src/lib/bridge.js");
    await bridge.reportSources(ORIGIN, ["src/App.jsx"]);
    resolve({
      owners: [
        { root: "/work", matches: 2, depth: 2 },
        { root: "/work/shop", matches: 2, depth: 5 },
      ],
      mapped: null,
    });
    expect(await bridge.resolveLink(ORIGIN)).toMatchObject({ root: "/work/shop" });
  });

  it("lets a mapping the user set win over file ownership", async () => {
    const bridge = await import("../extensions/core/src/lib/bridge.js");
    await bridge.reportSources(ORIGIN, ["src/App.jsx"]);
    resolve({
      owners: [{ root: "/work/shop", matches: 3, depth: 3 }],
      mapped: "/work",
    });
    expect(await bridge.resolveLink(ORIGIN)).toMatchObject({ root: "/work" });
  });

  it("asks which project only when no root owns the files, and honours that choice", async () => {
    const bridge = await import("../extensions/core/src/lib/bridge.js");
    await bridge.reportSources(ORIGIN, ["src/Nowhere.jsx"]);
    resolve({ owners: [], mapped: null });
    expect((await bridge.resolveLink(ORIGIN)).kind).toBe("choose");
    await bridge.chooseProject(ORIGIN, "/work");
    expect(await bridge.resolveLink(ORIGIN)).toEqual({ kind: "connected", root: "/work" });
  });

  it("refuses a choice of a project the helper does not know", async () => {
    const bridge = await import("../extensions/core/src/lib/bridge.js");
    resolve({ owners: [], mapped: null });
    await expect(bridge.chooseProject(ORIGIN, "/elsewhere")).rejects.toMatchObject({
      kind: "choose",
    });
  });
});
