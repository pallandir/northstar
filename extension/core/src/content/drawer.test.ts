import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeferralNotice, PinModel } from "../messages.js";
import { Drawer, type DrawerHandlers } from "./drawer.js";
import type { Surface } from "./surface.js";

afterEach(() => {
  document.body.replaceChildren();
});

function fakeSurface(): Surface {
  return { append: (el: HTMLElement) => document.body.append(el) } as unknown as Surface;
}

function handlers(overrides: Partial<DrawerHandlers> = {}): DrawerHandlers {
  return {
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
    onRevert: vi.fn(),
    onHoverComment: vi.fn(),
    onDismissNotice: vi.fn(),
    ...overrides,
  };
}

function notice(overrides: Partial<DeferralNotice> = {}): DeferralNotice {
  return {
    commentId: "c-1",
    page: "/dashboard",
    summary: "Rework the traffic sources chart",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Drawer notices", () => {
  it("shows nothing when there are no notices", () => {
    const surface = fakeSurface();
    const drawer = new Drawer(surface, handlers());
    drawer.setOpen(true, [], { mode: "local", connected: true }, []);
    expect(document.querySelector(".ns-notices")).toBeNull();
  });

  it("renders a notice with its page and summary on the Comments tab", () => {
    const surface = fakeSurface();
    const drawer = new Drawer(surface, handlers());
    drawer.setOpen(true, [], { mode: "local", connected: true }, [notice()]);
    expect(document.querySelector(".ns-notices-title")?.textContent).toBe("1 comment needs a plan");
    expect(document.querySelector(".ns-notice-route")?.textContent).toBe("/dashboard");
    expect(document.querySelector(".ns-notice-summary")?.textContent).toBe(
      "Rework the traffic sources chart",
    );
  });

  it("calls onDismissNotice with the comment id when Dismiss is clicked", () => {
    const onDismissNotice = vi.fn();
    const surface = fakeSurface();
    const drawer = new Drawer(surface, handlers({ onDismissNotice }));
    drawer.setOpen(true, [], { mode: "local", connected: true }, [notice({ commentId: "c-42" })]);
    const dismiss = document.querySelector<HTMLButtonElement>(".ns-notice-dismiss");
    dismiss?.click();
    expect(onDismissNotice).toHaveBeenCalledWith("c-42");
  });

  it("hides notices on the History tab", () => {
    const surface = fakeSurface();
    const drawer = new Drawer(surface, handlers());
    drawer.setOpen(true, [], { mode: "local", connected: true }, [notice()]);
    const historyTab = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".ns-drawer-tab"),
    ).find((b) => b.textContent?.startsWith("History"));
    historyTab?.click();
    expect(document.querySelector(".ns-notices")).toBeNull();
  });

  it("a deferred (wontfix) pin still appears in the Comments list alongside its notice", () => {
    const surface = fakeSurface();
    const drawer = new Drawer(surface, handlers());
    const pin: PinModel = {
      key: "c-1",
      operator: "/html/body/div[1]",
      text: "Rework the traffic sources chart",
      status: "wontfix",
      kind: "comment",
      removable: false,
      route: "/dashboard",
      target: "TrafficSources",
      planFirst: false,
      hasScreenshot: false,
    };
    drawer.setOpen(true, [pin], { mode: "local", connected: true }, [notice()]);
    expect(document.querySelector(".ns-notices")).not.toBeNull();
    expect(document.querySelector(".ns-drawer-item")).not.toBeNull();
  });
});
