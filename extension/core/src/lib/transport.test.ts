import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLocalUrl } from "./transport.js";

describe("isLocalUrl", () => {
  it("accepts http://localhost with a port", () => {
    expect(isLocalUrl("http://localhost:3000/")).toBe(true);
  });

  it("accepts http://127.0.0.1", () => {
    expect(isLocalUrl("http://127.0.0.1:8080/path")).toBe(true);
  });

  it("accepts *.localhost subdomains", () => {
    expect(isLocalUrl("http://myapp.localhost/")).toBe(true);
  });

  it("accepts nested *.localhost subdomains", () => {
    expect(isLocalUrl("http://a.b.localhost/")).toBe(true);
  });

  it("accepts IPv6 loopback [::1]", () => {
    expect(isLocalUrl("http://[::1]/")).toBe(true);
  });

  it("rejects a public hostname", () => {
    expect(isLocalUrl("https://example.com/")).toBe(false);
  });

  it("rejects a hostname that ends with 'localhost' but is not a subdomain", () => {
    expect(isLocalUrl("https://notlocalhost/")).toBe(false);
  });

  it("rejects an empty string (invalid URL)", () => {
    expect(isLocalUrl("")).toBe(false);
  });

  it("rejects a plain string that is not a URL", () => {
    expect(isLocalUrl("not a url")).toBe(false);
  });

  it("rejects a file:// URL", () => {
    expect(isLocalUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("flush", () => {
  const store = (globalThis as unknown as { __northstarStorage: { local: Map<string, unknown> } })
    .__northstarStorage.local;

  const draft = (comment: string) => ({
    comment,
    operation: { type: "comment" as const, property: null, from: null, to: null },
    operator: "/html/body",
    url: "http://localhost:3000/",
    metadata: { page: "/", viewport: { w: 800, h: 600 }, elementText: "" },
    source: null,
    screenshotDataUrl: null,
  });

  function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = handler(url, init);
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    return calls;
  }

  const health = {
    ok: true,
    service: "northstar",
    root: "/repo",
    startedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    notices: [],
    terminal: { available: true, driver: "tmux" },
  };

  beforeEach(async () => {
    store.clear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("posts the whole queue as one request", async () => {
    const mod = await import("./transport.js");
    await mod.enqueue(draft("first"));
    await mod.enqueue(draft("second"));

    const calls = stubFetch((url) =>
      url.endsWith("/comments") ? { ids: ["c-1", "c-2"], typed: true } : health,
    );
    const result = await mod.flush();

    const posts = calls.filter((c) => c.init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0].init?.body as string)).toHaveLength(2);
    expect(result.send).toEqual({ sent: 2, typed: true, reason: undefined });
    expect(result.status.queued).toBe(0);
  });

  it("reports a failed handoff without losing the batch from the store", async () => {
    const mod = await import("./transport.js");
    await mod.enqueue(draft("only"));

    stubFetch((url) =>
      url.endsWith("/comments")
        ? { ids: ["c-1"], typed: false, reason: "no supported terminal detected" }
        : health,
    );
    const result = await mod.flush();

    expect(result.send.typed).toBe(false);
    expect(result.send.reason).toBe("no supported terminal detected");
    expect(result.status.queued).toBe(0);
  });

  it("keeps the queue when the server cannot be reached", async () => {
    const mod = await import("./transport.js");
    await mod.enqueue(draft("kept"));

    vi.stubGlobal("fetch", async () => {
      throw new Error("connection refused");
    });
    const result = await mod.flush();

    expect(result.send.typed).toBe(false);
    expect(result.status.serverReachable).toBe(false);
    expect(result.status.queued).toBe(1);
  });

  it("sends no request and types nothing when the queue is empty", async () => {
    const mod = await import("./transport.js");
    const calls = stubFetch(() => health);
    const result = await mod.flush();

    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(0);
    expect(result.send).toEqual({ sent: 0, typed: false });
  });

  it("carries the terminal status through to the toolbar", async () => {
    const mod = await import("./transport.js");
    stubFetch(() => health);
    const status = await mod.status();
    expect(status.terminal).toEqual({ available: true, driver: "tmux" });
  });
});
