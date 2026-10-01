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
    onDeactivate: vi.fn(),
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

describe("Toolbar send guard", () => {
  it("disables Send while a send is in flight and re-enables it after", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ status: reachableStatus() }));
    const send = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Send"),
    );
    expect(send?.disabled).toBe(false);
    toolbar.setSending(true);
    expect(send?.disabled).toBe(true);
    toolbar.render(state({ status: reachableStatus() }));
    expect(send?.disabled).toBe(true);
    toolbar.setSending(false);
    expect(send?.disabled).toBe(false);
  });
});

const tipOf = (selector: string): string | undefined =>
  document.querySelector<HTMLElement>(selector)?.dataset.tip;

function buttonByTip(part: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.dataset.tip?.includes(part),
  );
  if (!found) throw new Error(`no button with a tooltip containing ${part}`);
  return found;
}

describe("Toolbar deactivate", () => {
  it("has a deactivate button that calls the handler and says what it does", () => {
    const onDeactivate = vi.fn();
    const toolbar = new Toolbar(fakeSurface(), handlers({ onDeactivate }));
    toolbar.render(state());
    const button = buttonByTip("Deactivate Northstar");
    expect(button.dataset.tip).toBe("Deactivate Northstar on this tab, your comments are kept");
    expect(button.getAttribute("aria-label")).toBe(button.dataset.tip);
    button.click();
    expect(onDeactivate).toHaveBeenCalledOnce();
  });

  it("sits last, after a separator, so it is not hit by accident next to Delete all", () => {
    new Toolbar(fakeSurface(), handlers());
    const root = document.querySelector(".ns-toolbar") as HTMLElement;
    const children = Array.from(root.children);
    expect(children.at(-1)).toBe(buttonByTip("Deactivate Northstar"));
    expect(children.at(-2)?.classList.contains("ns-sep")).toBe(true);
    expect(children.at(-3)).toBe(buttonByTip("Delete all comments"));
  });
});

describe("Toolbar tooltips", () => {
  it("every button has a tooltip, and icon only controls also have an accessible name", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ status: reachableStatus() }));
    const controls = document.querySelectorAll<HTMLElement>(".ns-toolbar > button, .ns-grip");
    expect(controls.length).toBe(7);
    for (const control of controls) {
      expect(control.dataset.tip?.length ?? 0, control.className).toBeGreaterThan(8);
      if (control.classList.contains("ns-action--icon") || control.classList.contains("ns-grip")) {
        expect(control.getAttribute("aria-label")).toBe(control.dataset.tip);
      }
    }
  });

  it("names the destructive and the plain actions clearly", () => {
    new Toolbar(fakeSurface(), handlers());
    expect(tipOf(".ns-grip")).toBe("Drag to move the toolbar");
    expect(buttonByTip("Delete all comments").dataset.tip).toBe("Delete all comments");
    expect(buttonByTip("Markdown file").dataset.tip).toBe(
      "Download all comments as a Markdown file",
    );
  });

  it("the pick toggle and the comments button describe the action they will take", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ picking: true, drawerOpen: false }));
    expect(buttonByTip("Picking is on").dataset.tip).toMatch(/click to pause/);
    expect(buttonByTip("Open the comments panel")).toBeTruthy();
    toolbar.render(state({ picking: false, drawerOpen: true }));
    expect(buttonByTip("Picking is paused").dataset.tip).toMatch(/click to pick/);
    expect(buttonByTip("Close the comments panel")).toBeTruthy();
  });

  it("Send explains why it is disabled, and counts what it will send", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    const send = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
        b.textContent?.startsWith("Send"),
      ) as HTMLButtonElement;

    toolbar.render(state({ status: { ...reachableStatus(), serverReachable: false, port: null } }));
    expect(send().disabled).toBe(true);
    expect(send().dataset.tip).toBe("Not connected, start your AI agent in this project first");

    toolbar.render(state({ status: reachableStatus({ queued: 0 }) }));
    expect(send().dataset.tip).toBe("Nothing to send yet, add a comment first");

    toolbar.render(state({ status: reachableStatus({ queued: 1 }) }));
    expect(send().disabled).toBe(false);
    expect(send().dataset.tip).toBe("Send 1 comment to your AI assistant");

    toolbar.render(state({ status: reachableStatus({ queued: 3 }) }));
    expect(send().dataset.tip).toBe("Send 3 comments to your AI assistant");

    toolbar.setSending(true);
    expect(send().dataset.tip).toBe("Sending your comments");
  });

  it("the dismiss button on a notice is named for screen readers and hover", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ status: { ...reachableStatus(), serverReachable: false, port: null } }));
    const dismiss = document.querySelector<HTMLButtonElement>(".ns-setup-row .ns-drawer-close");
    expect(dismiss?.title).toBe("Dismiss this notice");
    expect(dismiss?.getAttribute("aria-label")).toBe("Dismiss this notice");
  });

  it("the first and last tooltips are anchored to their own edge so they cannot clip", () => {
    new Toolbar(fakeSurface(), handlers());
    expect(document.querySelector(".ns-grip")?.classList.contains("ns-has-tip--start")).toBe(true);
    expect(buttonByTip("Deactivate").classList.contains("ns-has-tip--end")).toBe(true);
  });
});
