import { afterEach, describe, expect, it, vi } from "vitest";
import type { Surface } from "../extensions/core/src/content/surface.js";
import {
  Toolbar,
  type ToolbarHandlers,
  type ToolbarState,
} from "../extensions/core/src/content/toolbar.js";
import type { QueueStatus } from "../extensions/core/src/messages.js";

vi.mock("../extensions/core/src/lib/browser.js", () => ({
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
    onChooseProject: vi.fn(),
    onCopyLine: vi.fn(),
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
    problem: null,
    ...overrides,
  };
}

const SESSION = {
  id: "s1",
  agent: "codex",
  name: "Codex",
  command: "/bin/codex",
  cwd: "/repo",
  root: "/repo",
  pid: 1,
  createdAt: "2026-01-01T00:00:00Z",
  lastActivityAt: "2026-01-01T00:00:00Z",
  kind: "interactive" as const,
};

function reachableStatus(overrides: Partial<QueueStatus> = {}): QueueStatus {
  return {
    queued: 1,
    failed: 0,
    connection: "connected",
    serverReachable: true,
    root: "/repo",
    notices: [],
    readiness: { ready: true, sessions: [SESSION], target: "s1", needsPick: false },
    open: 0,
    lastPolledAt: null,
    handoff: null,
    projects: [],
    template: "resolve",
    problem: null,
    ...overrides,
  };
}

function offlineStatus(overrides: Partial<QueueStatus> = {}): QueueStatus {
  return reachableStatus({
    connection: "offline",
    serverReachable: false,
    readiness: null,
    ...overrides,
  });
}

const NO_SESSION = {
  ready: false,
  sessions: [],
  target: null,
  needsPick: false,
  reason: "No agent session is running in this project.",
  fix: "Start your agent with northstar run claude.",
};

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
  it("shows a strip with the install command when the helper is missing", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(
      state({
        status: offlineStatus({
          problem: {
            error: "Northstar's browser helper is not installed.",
            fix: "Run npm install -g @pallandir/northstar, then northstar install, then reload this page.",
          },
        }),
      }),
    );
    expect(document.querySelector(".ns-setup-title")?.textContent).toBe(
      "Northstar's browser helper is not installed.",
    );
    expect(document.querySelector(".ns-setup-hint")?.textContent).toContain(
      "npm install -g @pallandir/northstar",
    );
  });

  it("says no project is running when the helper answers but no agent has started", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ status: offlineStatus({ connection: "noproject" }) }));
    expect(document.querySelector(".ns-setup-title")?.textContent).toBe("No project is running");
  });

  it("shows nothing once the server is reachable and everything is healthy", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ status: reachableStatus() }));
    expect(document.querySelector(".ns-tb-panel")?.hasAttribute("hidden")).toBe(true);
  });

  it("dismissing a strip keeps it hidden while the same problem persists", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    const offline = state({ status: offlineStatus() });
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
    toolbar.render(state({ status: offlineStatus() }));
    document.querySelector<HTMLButtonElement>(".ns-setup-row .ns-drawer-close")?.click();

    toolbar.render(
      state({
        status: reachableStatus({
          readiness: {
            ...NO_SESSION,
            reason: "no session found",
            fix: "Run it with northstar run.",
          },
        }),
      }),
    );
    expect(document.querySelector(".ns-setup-title")?.textContent).toBe(
      "Northstar cannot reach your assistant",
    );
    expect(document.querySelector(".ns-setup-hint")?.textContent).toBe(
      "no session found Run it with northstar run.",
    );
  });
});

describe("Toolbar connection strips", () => {
  it("lists every running project and reports the one picked", () => {
    const onChooseProject = vi.fn();
    const toolbar = new Toolbar(fakeSurface(), handlers({ onChooseProject }));
    toolbar.render(
      state({
        status: reachableStatus({
          connection: "choose",
          serverReachable: false,
          projects: [
            { root: "/work/shop", project: "shop" },
            { root: "/work/blog", project: "blog" },
          ],
        }),
      }),
    );
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".ns-setup-actions button"),
    );
    expect(buttons.map((b) => b.textContent)).toEqual(["shop", "blog"]);
    buttons[1].click();
    expect(onChooseProject).toHaveBeenCalledWith("/work/blog");
  });

  it("asks which session to send to when more than one runs, and sends to the one picked", () => {
    const onSend = vi.fn();
    const toolbar = new Toolbar(fakeSurface(), handlers({ onSend }));
    const other = { ...SESSION, id: "s2", agent: "claude", name: "Claude Code", cwd: "/repo/web" };
    toolbar.render(
      state({
        status: reachableStatus({
          readiness: {
            ready: true,
            sessions: [SESSION, other],
            target: null,
            needsPick: true,
            reason: "More than one agent session is running in this project.",
            fix: "Pick the session to send to.",
          },
        }),
      }),
    );
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".ns-setup-actions button"),
    );
    expect(buttons.map((b) => b.textContent)).toEqual(["Codex, repo", "Claude Code, web"]);
    buttons[1].click();
    expect(onSend).toHaveBeenCalledWith("s2");
    const send = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      b.textContent?.startsWith("Send"),
    );
    expect(send?.disabled).toBe(true);
    expect(send?.dataset.tip).toBe("Pick the session to send to below");
  });

  it("offers only Copy the line, with or without comments, so the connection can come first", () => {
    const onCopyLine = vi.fn();
    const toolbar = new Toolbar(fakeSurface(), handlers({ onCopyLine }));
    for (const queued of [0, 2]) {
      toolbar.render(
        state({ status: reachableStatus({ queued, open: queued, readiness: NO_SESSION }) }),
      );
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".ns-setup-actions button"),
      );
      expect(buttons.map((b) => b.textContent)).toEqual(["Copy the line"]);
    }
    document.querySelector<HTMLButtonElement>(".ns-setup-actions button")?.click();
    expect(onCopyLine).toHaveBeenCalledOnce();
  });

  it("says the assistant is working, with Copy the line, instead of an error", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(
      state({
        status: reachableStatus({
          queued: 1,
          readiness: {
            ...NO_SESSION,
            working: true,
            reason: "Your AI assistant is working on your comments.",
            fix: "Your new comments are saved.",
          },
        }),
      }),
    );
    expect(document.querySelector(".ns-setup-title")?.textContent).toBe(
      "Your assistant is working",
    );
    expect(
      Array.from(document.querySelectorAll(".ns-setup-actions button")).map((b) => b.textContent),
    ).toEqual(["Copy the line"]);
  });

  it("names the side to update on a version mismatch", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(
      state({
        status: reachableStatus({
          connection: "mismatch",
          serverReachable: false,
          problem: {
            error: "Update Northstar: the extension and the server versions differ.",
            fix: "Update the Northstar server, then restart your AI agent.",
          },
        }),
      }),
    );
    expect(document.querySelector(".ns-setup-hint")?.textContent).toBe(
      "Update the Northstar server, then restart your AI agent.",
    );
  });

  it("shows an error and its fix for a failed action", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(
      state({
        status: reachableStatus(),
        problem: {
          error: "The page changed before the comment was saved.",
          fix: "Pick the element again.",
        },
      }),
    );
    expect(document.querySelector(".ns-setup-title")?.textContent).toBe(
      "The page changed before the comment was saved.",
    );
    expect(document.querySelector(".ns-setup-hint")?.textContent).toBe("Pick the element again.");
  });

  it("reports a handoff the agent never received", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(
      state({
        status: reachableStatus({
          handoff: {
            delivered: false,
            session: { id: "s1", agent: "codex", name: "Codex" },
            reason: "Codex did not start on the comments within 20 seconds.",
            fix: "Check Codex.",
            at: "2026-01-01T00:00:00Z",
          },
        }),
      }),
    );
    expect(document.querySelector(".ns-setup-title")?.textContent).toBe(
      "Comments saved, the agent did not start",
    );
  });

  it("tells the user when the agent needs them first, with why and how to fix it", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(
      state({
        status: reachableStatus({
          handoff: {
            delivered: false,
            session: { id: "s1", agent: "codex", name: "Codex" },
            blocked: "prompt",
            reason: "Northstar did not write to Codex, the agent is waiting on a prompt.",
            fix: "Answer the prompt in the agent, then click Send to AI again.",
            at: "2026-01-01T00:00:00Z",
          },
        }),
      }),
    );
    expect(document.querySelector(".ns-setup-title")?.textContent).toBe(
      "Comments saved, the agent needs you first",
    );
    expect(document.querySelector(".ns-setup-hint")?.textContent).toContain("Answer the prompt");
  });

  it("flashes Saved on the comments button, then restores the count", () => {
    vi.useFakeTimers();
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ count: 3 }));
    toolbar.flashSaved();
    expect(document.body.textContent).toContain("Saved");
    vi.advanceTimersByTime(2000);
    expect(document.body.textContent).toContain("Comments (3)");
    vi.useRealTimers();
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
      "Download this page's unsent comments as a Markdown file",
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

    toolbar.render(state({ status: offlineStatus() }));
    expect(send().disabled).toBe(true);
    expect(send().dataset.tip).toBe("Not connected, open your AI assistant in this project");

    toolbar.render(state({ status: reachableStatus({ queued: 0 }) }));
    expect(send().dataset.tip).toBe("Nothing to send yet, add a comment first");

    toolbar.render(state({ status: reachableStatus({ queued: 1 }) }));
    expect(send().disabled).toBe(false);
    expect(send().dataset.tip).toBe("Send 1 comment to your AI assistant");

    toolbar.render(state({ status: reachableStatus({ queued: 3 }) }));
    expect(send().dataset.tip).toBe("Send 3 comments to your AI assistant");

    toolbar.render(state({ status: reachableStatus({ queued: 0, open: 2 }) }));
    expect(send().disabled).toBe(false);
    expect(send().dataset.tip).toBe("Send 2 comments to your AI assistant");

    toolbar.render(
      state({
        status: reachableStatus({ queued: 2, readiness: NO_SESSION }),
      }),
    );
    expect(send().disabled).toBe(true);
    expect(send().dataset.tip).toBe(
      "Send to AI is off, No agent session is running in this project. Start your agent with northstar run claude.",
    );

    toolbar.setSending(true);
    expect(send().dataset.tip).toBe("Sending to your AI assistant");
    toolbar.setSending(false);

    toolbar.flashSent({
      sent: 0,
      rejected: 0,
      woke: {
        delivered: true,
        session: { id: "s1", agent: "claude", name: "Claude Code" },
        at: "now",
      },
    });
    expect(document.body.textContent).toContain("Sent to Claude Code");
  });

  it("the dismiss button on a notice is named for screen readers and hover", () => {
    const toolbar = new Toolbar(fakeSurface(), handlers());
    toolbar.render(state({ status: offlineStatus() }));
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
