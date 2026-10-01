import { TEMPLATE_IDS } from "@northstar/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type HostCall, HostFailure, installFakeHost } from "../tests/native-host.js";

const ROOT = "/work/shop";
const PROJECT = { root: ROOT, name: "shop", sessions: 1 };
const delivered = {
  delivered: true,
  session: { id: "s1", agent: "codex", name: "Codex" },
  at: "2026-01-01T00:00:00.000Z",
};

interface Chrome {
  contextMenus: { removeAll: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  scripting: { executeScript: ReturnType<typeof vi.fn> };
  action: { setBadgeText: ReturnType<typeof vi.fn>; setTitle: ReturnType<typeof vi.fn> };
}

function chromeStub(): Chrome {
  const chromeApi = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
  const stub: Chrome = {
    contextMenus: { removeAll: vi.fn().mockResolvedValue(undefined), create: vi.fn() },
    scripting: { executeScript: vi.fn() },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
    },
  };
  Object.assign(chromeApi, stub);
  return stub;
}

function page(selection: string, title = "Auth crashes on Safari") {
  return [{ result: { selection, title, width: 1280, height: 800 } }];
}

function host(
  answers: Record<string, (params: Record<string, unknown>) => unknown> = {},
  projects: unknown[] = [PROJECT],
) {
  return installFakeHost((action, params) => {
    if (action === "project.list") return projects;
    if (action === "config.get") return { preferredAgent: null, template: "resolve", projects: {} };
    const answer = answers[action];
    if (!answer) throw new Error(`unexpected ${action}`);
    return answer(params);
  });
}

const call = (calls: HostCall[], action: string) => calls.find((c) => c.action === action);

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the context menu", () => {
  it("offers the selection, one entry per template and the page action for local pages", async () => {
    const stub = chromeStub();
    const { installMenus } = await import("./send-menu.js");
    await installMenus();
    expect(stub.contextMenus.removeAll).toHaveBeenCalledOnce();
    const created = stub.contextMenus.create.mock.calls.map((c) => c[0]);
    expect(created.map((c) => c.title)).toContain("Send selection to AI");
    expect(created.filter((c) => c.parentId === "northstar-as")).toHaveLength(TEMPLATE_IDS.length);
    const pageEntry = created.find((c) => c.id === "northstar-page");
    expect(pageEntry.documentUrlPatterns).toContain("http://localhost/*");
  });
});

describe("sending a selection", () => {
  const tab = { id: 7, url: "https://github.com/acme/backend/issues/42" } as chrome.tabs.Tab;

  it("stores the selection as a comment and sends the fixed template, never the text", async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue(
      page("Safari users get an authentication error."),
    );
    const fake = host({
      "comments.add": (params) => ({
        ids: ["c1"],
        accepted: [{ cid: (params.drafts as Array<{ cid: string }>)[0]?.cid, id: "c1" }],
        rejected: [],
      }),
      "session.send": () => delivered,
    });
    const { runSend } = await import("./send-menu.js");
    await runSend(tab, "fix");

    const add = call(fake.calls, "comments.add");
    const drafts = add?.params.drafts as Array<Record<string, unknown>>;
    expect(add?.params.root).toBe(ROOT);
    expect(drafts[0]).toMatchObject({
      comment: "Safari users get an authentication error.",
      url: tab.url,
      operation: { type: "comment" },
      metadata: { page: "/acme/backend/issues/42", viewport: { w: 1280, h: 800 } },
    });
    expect(call(fake.calls, "session.send")?.params).toEqual({ root: ROOT, template: "fix" });
    expect(stub.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "✓" });
    expect(stub.action.setTitle.mock.calls[0]?.[0].title).toContain("Sent to Codex");
  });

  it("uses the default template from the options when none is chosen", async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue(page("text"));
    const fake = host({
      "comments.add": (params) => ({
        ids: ["c1"],
        accepted: [{ cid: (params.drafts as Array<{ cid: string }>)[0]?.cid, id: "c1" }],
        rejected: [],
      }),
      "session.send": () => delivered,
    });
    const { runSend } = await import("./send-menu.js");
    await runSend(tab);
    expect(call(fake.calls, "session.send")?.params.template).toBe("resolve");
  });

  it("shows why on the toolbar badge when the agent needs the user first", async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue(page("text"));
    host({
      "comments.add": (params) => ({
        ids: ["c1"],
        accepted: [{ cid: (params.drafts as Array<{ cid: string }>)[0]?.cid, id: "c1" }],
        rejected: [],
      }),
      "session.send": () => ({
        delivered: false,
        session: { id: "s1", agent: "codex", name: "Codex" },
        blocked: "prompt",
        reason: "Northstar did not write to Codex, the agent is waiting on a prompt.",
        fix: "Answer the prompt in the agent, then click Send to AI again.",
        at: "now",
      }),
    });
    const { runSend } = await import("./send-menu.js");
    await runSend(tab);
    expect(stub.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "!" });
    expect(stub.action.setTitle.mock.calls[0]?.[0].title).toContain("Answer the prompt");
  });

  it("reports a refused selection and a missing session with their fixes", async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue(page("text"));
    host({
      "comments.add": () => ({
        ids: [],
        accepted: [],
        rejected: [
          {
            cid: "x",
            field: "comment",
            error: "The comment field is too long.",
            fix: "Select less.",
          },
        ],
      }),
    });
    const { runSend } = await import("./send-menu.js");
    await runSend(tab);
    expect(stub.action.setTitle.mock.calls[0]?.[0].title).toContain("Select less.");

    vi.resetModules();
    const again = chromeStub();
    again.scripting.executeScript.mockResolvedValue(page("text"));
    host({
      "comments.add": (params) => ({
        ids: ["c1"],
        accepted: [{ cid: (params.drafts as Array<{ cid: string }>)[0]?.cid, id: "c1" }],
        rejected: [],
      }),
      "session.send": () => {
        throw new HostFailure(
          "NO_SESSION",
          "No agent session is running in this project.",
          "Start your agent with northstar run.",
        );
      },
    });
    const second = await import("./send-menu.js");
    await second.runSend(tab);
    expect(again.action.setTitle.mock.calls[0]?.[0].title).toContain("northstar run");
  });

  it("asks to select text on a page that is not local", async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue(page(""));
    host();
    const { runSend } = await import("./send-menu.js");
    await runSend(tab);
    expect(stub.action.setTitle.mock.calls[0]?.[0].title).toContain("Nothing is selected");
  });

  it("asks which project when several are known and the site is not mapped", async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue(page("text"));
    host({ "project.resolve": () => ({ owners: [], mapped: null }) }, [
      PROJECT,
      { root: "/work/blog", name: "blog", sessions: 1 },
    ]);
    const { runSend } = await import("./send-menu.js");
    await runSend(tab);
    expect(stub.action.setTitle.mock.calls[0]?.[0].title).toContain("map this site to a project");
  });

  it("refuses pages that are not http or https", async () => {
    const stub = chromeStub();
    host();
    const { runSend } = await import("./send-menu.js");
    await runSend({ id: 3, url: "chrome://settings" } as chrome.tabs.Tab);
    expect(stub.scripting.executeScript).not.toHaveBeenCalled();
    expect(stub.action.setTitle.mock.calls[0]?.[0].title).toContain("web pages only");
  });
});

describe("sending the comments on a local page", () => {
  it("flushes the queue and sends when nothing is selected", async () => {
    const stub = chromeStub();
    stub.scripting.executeScript.mockResolvedValue(page(""));
    const fake = host({
      "agent.list": () => [],
      "status.get": () => ({
        notices: [],
        readiness: { ready: true, sessions: [], target: null, needsPick: false },
        open: 2,
        lastPolledAt: null,
        handoff: null,
      }),
      "session.send": () => delivered,
    });
    const { runSend } = await import("./send-menu.js");
    await runSend({ id: 9, url: "http://localhost:3000/" } as chrome.tabs.Tab, "review");
    expect(call(fake.calls, "session.send")?.params).toEqual({ root: ROOT, template: "review" });
    expect(stub.action.setBadgeText).toHaveBeenCalledWith({ tabId: 9, text: "✓" });
  });
});
