import { afterEach, describe, expect, it, vi } from "vitest";
import { Surface } from "./surface.js";

const surfaces: Surface[] = [];
afterEach(() => {
  for (const s of surfaces.splice(0)) s.unmount();
  document.body.replaceChildren();
});

function make(): Surface {
  const s = new Surface();
  surfaces.push(s);
  return s;
}

function target(): HTMLElement {
  const el = document.createElement("p");
  el.textContent = "hello";
  document.body.append(el);
  return el;
}

function root(): HTMLElement {
  const host = document.getElementById("northstar-root");
  if (!host) throw new Error("overlay host is not mounted");
  return host;
}

describe("Surface inspector", () => {
  it("opens without a target header or an arrow", () => {
    const s = make();
    const handle = s.showInspector(target(), vi.fn(), vi.fn());
    expect(handle.panel.querySelector(".ns-inspector-target")).toBeNull();
    expect(handle.panel.className).not.toContain("ns-inspector--");
    expect(s.hasInspector()).toBe(true);
  });

  it("Delete in an edit popover closes the panel", () => {
    const s = make();
    const onDelete = vi.fn();
    const handle = s.showInspector(target(), vi.fn(), vi.fn(), {
      editOnly: true,
      initialText: "x",
      onDelete,
    });
    const del = Array.from(handle.panel.querySelectorAll("button")).find(
      (b) => b.textContent === "Delete",
    );
    del?.click();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(s.hasInspector()).toBe(false);
  });

  it("closeInspector reverts and clears the open popover", () => {
    const s = make();
    const onCancel = vi.fn();
    s.showInspector(target(), vi.fn(), onCancel);
    s.closeInspector();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(s.hasInspector()).toBe(false);
  });
});

describe("Surface modal", () => {
  it("unmount removes an open confirmation and its Escape listener", () => {
    const s = make();
    const onDismiss = vi.fn();
    s.showModal({ title: "t", body: "b", actions: [], onDismiss });
    s.unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(document.getElementById("northstar-root")).toBeNull();
  });

  it("Escape dismisses an open confirmation once", () => {
    const s = make();
    const onDismiss = vi.fn();
    s.showModal({ title: "t", body: "b", actions: [], onDismiss });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("Surface host", () => {
  it("keeps key events typed into the overlay away from the page", () => {
    const s = make();
    s.mount();
    const pageSaw = vi.fn();
    document.addEventListener("keydown", pageSaw);
    root().dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    document.removeEventListener("keydown", pageSaw);
    expect(pageSaw).not.toHaveBeenCalled();
  });

  it("consumes Escape at the host", () => {
    const s = make();
    s.mount();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    root().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
