import { afterEach, describe, expect, it, vi } from "vitest";
import { type PickerHost, installPicker } from "../extensions/core/src/content/picker.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const fn of teardowns.splice(0)) fn();
  document.body.replaceChildren();
});

function host(overrides: Partial<PickerHost> = {}): PickerHost {
  return {
    isActive: () => true,
    isPicking: () => true,
    isModalOpen: () => false,
    ownsEvent: () => false,
    hasInspector: () => false,
    closeInspector: vi.fn(),
    hasSelection: () => false,
    clearSelection: vi.fn(),
    onHover: vi.fn(),
    onPick: vi.fn(),
    ...overrides,
  };
}

function install(h: PickerHost): void {
  teardowns.push(installPicker(h));
}

function target(): HTMLButtonElement {
  const el = document.createElement("button");
  document.body.append(el);
  return el;
}

function fire(el: Element, type: string): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe("installPicker", () => {
  it("swallows the whole pointer sequence so the page never sees it, and picks on click", () => {
    const h = host();
    install(h);
    const el = target();
    const pageSaw = vi.fn();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.addEventListener(type, pageSaw);
    }
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      expect(fire(el, type).defaultPrevented).toBe(true);
    }
    expect(pageSaw).not.toHaveBeenCalled();
    expect(h.onPick).toHaveBeenCalledOnce();
    expect(h.onPick).toHaveBeenCalledWith(el);
  });

  it("leaves page events alone when not picking", () => {
    const h = host({ isPicking: () => false });
    install(h);
    const el = target();
    const pageSaw = vi.fn();
    el.addEventListener("click", pageSaw);
    expect(fire(el, "click").defaultPrevented).toBe(false);
    expect(pageSaw).toHaveBeenCalledOnce();
    expect(h.onPick).not.toHaveBeenCalled();
  });

  it("ignores events that belong to the overlay itself", () => {
    const h = host({ ownsEvent: () => true });
    install(h);
    fire(target(), "click");
    expect(h.onPick).not.toHaveBeenCalled();
  });

  it("treats a pick while an inspector is open as an outside click: cancel, then pick", () => {
    const order: string[] = [];
    const h = host({
      hasInspector: () => true,
      closeInspector: () => order.push("close"),
      onPick: () => order.push("pick"),
    });
    install(h);
    fire(target(), "click");
    expect(order).toEqual(["close", "pick"]);
  });

  it("Escape closes the inspector even when focus left the panel", () => {
    const h = host({ hasInspector: () => true });
    install(h);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(h.closeInspector).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("Escape clears a lone selection and does not consume the key", () => {
    const h = host({ hasSelection: () => true });
    install(h);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(h.clearSelection).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it("Escape is left to the modal while one is open", () => {
    const h = host({ hasInspector: () => true, isModalOpen: () => true });
    install(h);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(h.closeInspector).not.toHaveBeenCalled();
  });

  it("stops intercepting once torn down", () => {
    const h = host();
    const stop = installPicker(h);
    stop();
    const el = target();
    expect(fire(el, "click").defaultPrevented).toBe(false);
    expect(h.onPick).not.toHaveBeenCalled();
  });
});
