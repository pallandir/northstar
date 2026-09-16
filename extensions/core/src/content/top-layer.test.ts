import { beforeEach, describe, expect, it, vi } from "vitest";

const shown: string[] = [];

function stubPopover(): void {
  Object.assign(HTMLElement.prototype, {
    showPopover(this: HTMLElement) {
      shown.push(`show:${this.id}`);
      this.dataset.popoverOpen = "true";
    },
    hidePopover(this: HTMLElement) {
      if (!this.dataset.popoverOpen) throw new Error("not showing");
      shown.push(`hide:${this.id}`);
      delete this.dataset.popoverOpen;
    },
  });
}

async function makeLayer() {
  stubPopover();
  const { TopLayer } = await import("./top-layer.js");
  const host = document.createElement("div");
  host.id = "northstar-root";
  const shadow = host.attachShadow({ mode: "open" });
  document.documentElement.append(host);
  const layer = new TopLayer();
  layer.attach(host, shadow);
  return { layer, host, shadow };
}

// The observer callback lands on a microtask and only then asks for a frame, so settling takes
// more than one turn.
const settle = async () => {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }
};

// happy-dom accepts the :modal selector but never matches it, even after showModal, so the
// browser behaviour is stood in for here.
function enableModalSelector(): void {
  const real = Element.prototype.matches;
  Element.prototype.matches = function (selector: string) {
    if (selector.includes(":modal")) {
      return this.tagName === "DIALOG" && this.hasAttribute("open");
    }
    return real.call(this, selector);
  };
}

function openDialog(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  document.body.append(dialog);
  dialog.setAttribute("open", "");
  return dialog;
}

describe("TopLayer", () => {
  const realMatches = Element.prototype.matches;

  beforeEach(() => {
    Element.prototype.matches = realMatches;
    document.body.replaceChildren();
    for (const node of document.documentElement.querySelectorAll("#northstar-root")) node.remove();
    shown.length = 0;
    vi.resetModules();
  });

  it("promotes the host into the top layer on attach", async () => {
    const { host, layer } = await makeLayer();
    expect(host.getAttribute("popover")).toBe("manual");
    expect(shown).toContain("show:northstar-root");
    layer.detach();
  });

  it("re-promotes when the page promotes something after us", async () => {
    const { layer } = await makeLayer();
    shown.length = 0;

    const pagePopover = document.createElement("div");
    pagePopover.setAttribute("popover", "manual");
    document.body.append(pagePopover);
    pagePopover.dispatchEvent(new Event("toggle", { bubbles: false }));
    await settle();

    expect(shown).toEqual(["hide:northstar-root", "show:northstar-root"]);
    layer.detach();
  });

  it("moves inside an open modal dialog so it is not made inert", async () => {
    enableModalSelector();
    const { host, layer } = await makeLayer();
    const dialog = openDialog();
    await settle();

    expect(host.parentElement).toBe(dialog);
    layer.detach();
  });

  it("moves back out when the dialog closes", async () => {
    enableModalSelector();
    const { host, layer } = await makeLayer();
    const dialog = openDialog();
    await settle();
    dialog.removeAttribute("open");
    await settle();

    expect(host.parentElement).toBe(document.documentElement);
    layer.detach();
  });

  it("keeps the caret where it was across a re-promotion", async () => {
    enableModalSelector();
    const { shadow, layer } = await makeLayer();
    const field = document.createElement("textarea");
    shadow.append(field);
    field.value = "half written comment";
    field.focus();
    field.setSelectionRange(4, 9);

    openDialog();
    await settle();

    expect(shadow.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([4, 9]);
    layer.detach();
  });

  it("stops promoting once detached", async () => {
    const { host, layer } = await makeLayer();
    layer.detach();
    expect(host.getAttribute("popover")).toBeNull();
    shown.length = 0;

    openDialog();
    await settle();

    expect(shown).toEqual([]);
  });
});
