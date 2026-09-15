import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueueStatus } from "../messages.js";
import type { Surface } from "./surface.js";
import { Toolbar, type ToolbarHandlers, type ToolbarState } from "./toolbar.js";

vi.mock("../lib/browser.js", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

afterEach(() => {
  document.body.replaceChildren();
});

function fakeSurface(): Surface {
  return { append: (el: HTMLElement) => document.body.append(el) } as unknown as Surface;
}

function handlers(overrides: Partial<ToolbarHandlers> = {}): ToolbarHandlers {
  return {
    onComments: vi.fn(),
    onSend: vi.fn(),
    onHandoff: vi.fn(),
    onReset: vi.fn(),
    onTogglePick: vi.fn(),
    ...overrides,
  };
}

function state(overrides: Partial<ToolbarState> = {}): ToolbarState {
  return {
    mode: "local",
    count: 0,
    noticeCount: 0,
    status: null,
    drawerOpen: false,
    lastSend: null,
    picking: true,
    ...overrides,
  };
}

function reachableStatus(overrides: Partial<QueueStatus> = {}): QueueStatus {
  return {
    queued: 1,
    serverReachable: true,
    port: 7474,
    root: "/repo",
    notices: [],
    version: 1,
    terminal: { available: true, driver: "tmux" },
    ...overrides,
  };
}

describe("Toolbar remote mode", () => {
  it("never shows a floating panel on a remote page", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ mode: "remote" }));
    expect(document.querySelector(".ns-tb-panel")?.hasAttribute("hidden")).toBe(true);
  });

  it("makes Handoff the primary action and hides Send to AI", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ mode: "remote" }));
    const buttons = Array.from(document.querySelectorAll("button"));
    const handoff = buttons.find((b) => b.textContent === "Handoff");
    expect(handoff?.classList.contains("ns-action--primary")).toBe(true);
  });
});

describe("Toolbar failure strip", () => {
  it("shows a strip when the server is unreachable", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ status: { ...reachableStatus(), serverReachable: false, port: null } }));
    expect(document.querySelector(".ns-setup-title")?.textContent).toBe(
      "No Northstar server on this machine",
    );
  });

  it("shows nothing once the server is reachable and everything is healthy", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ status: reachableStatus() }));
    expect(document.querySelector(".ns-tb-panel")?.hasAttribute("hidden")).toBe(true);
  });

  it("dismissing a strip keeps it hidden while the same problem persists", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    const offline = state({ status: { ...reachableStatus(), serverReachable: false, port: null } });
    toolbar.render(offline);
    expect(document.querySelector<HTMLElement>(".ns-tb-panel")?.hidden).toBe(false);

    document.querySelector<HTMLButtonElement>(".ns-setup-row .ns-drawer-close")?.click();
    expect(document.querySelector<HTMLElement>(".ns-tb-panel")?.hidden).toBe(true);

    // A later poll reporting the exact same problem must not resurrect the dismissed strip.
    toolbar.render(offline);
    expect(document.querySelector<HTMLElement>(".ns-tb-panel")?.hidden).toBe(true);
  });

  it("a genuinely different problem still shows after an earlier one was dismissed", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ status: { ...reachableStatus(), serverReachable: false, port: null } }));
    document.querySelector<HTMLButtonElement>(".ns-setup-row .ns-drawer-close")?.click();

    toolbar.render(
      state({
        status: reachableStatus({ terminal: { available: false, reason: "no terminal found" } }),
      }),
    );
    expect(document.querySelector(".ns-setup-title")?.textContent).toBe(
      "Comments will not reach your agent",
    );
  });
});

describe("Toolbar notice count", () => {
  it("appends the needs-a-plan count to the Comments label", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ count: 2, noticeCount: 1 }));
    const comments = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Comments"),
    );
    expect(comments?.textContent).toBe("Comments (2) · 1 needs a plan");
  });
});
