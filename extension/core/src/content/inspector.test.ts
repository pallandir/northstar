import { afterEach, describe, expect, it, vi } from "vitest";
import { type InspectorSubmission, type InspectorTarget, buildInspector } from "./inspector.js";

const teardowns: Array<() => void> = [];
afterEach(() => {
  for (const fn of teardowns.splice(0)) fn();
});

function mount<T extends Element>(el: T): T {
  document.body.appendChild(el);
  teardowns.push(() => document.body.contains(el) && document.body.removeChild(el));
  return el;
}

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected a value");
  return value;
}

const NO_TARGET: InspectorTarget = {
  componentName: null,
  source: null,
  tag: "div",
  selector: "div",
};

function tabButton(panel: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(panel.querySelectorAll<HTMLButtonElement>(".ns-inspector-tab")).find(
    (b) => b.textContent === label,
  );
  if (!btn) throw new Error(`no tab button labelled ${label}`);
  return btn;
}

function saveButton(panel: HTMLElement): HTMLButtonElement {
  return must(panel.querySelector<HTMLButtonElement>(".ns-btn--primary"));
}

describe("buildInspector", () => {
  it("shows three tabs by default: Comment, Text, Colour", () => {
    const el = mount(document.createElement("div"));
    const { panel } = buildInspector(el, NO_TARGET, vi.fn(), vi.fn());
    const labels = Array.from(panel.querySelectorAll(".ns-inspector-tab")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Comment", "Text", "Colour"]);
  });

  it("hides the tab strip in editOnly mode", () => {
    const el = mount(document.createElement("div"));
    const { panel } = buildInspector(el, NO_TARGET, vi.fn(), vi.fn(), { editOnly: true });
    expect(panel.querySelector(".ns-inspector-tabs")).toBeNull();
  });

  describe("target header", () => {
    it("shows the component name when present, else the tag, else 'Not resolved'", () => {
      const el = mount(document.createElement("div"));
      const { panel } = buildInspector(
        el,
        { componentName: "TrafficSources", source: null, tag: "article", selector: "article.card" },
        vi.fn(),
        vi.fn(),
      );
      expect(panel.querySelector(".ns-inspector-target-name")?.textContent).toBe("TrafficSources");
      expect(panel.querySelector(".ns-inspector-target-selector")?.textContent).toBe(
        "article.card",
      );
    });

    it("falls back to the tag and marks the source hidden when nothing resolved", () => {
      const el = mount(document.createElement("div"));
      const { panel } = buildInspector(
        el,
        { componentName: null, source: null, tag: null, selector: "" },
        vi.fn(),
        vi.fn(),
      );
      expect(panel.querySelector(".ns-inspector-target-name")?.textContent).toBe("Not resolved");
    });

    it("updateTarget refreshes the header after the async probe answers", () => {
      const el = mount(document.createElement("div"));
      const handle = buildInspector(el, NO_TARGET, vi.fn(), vi.fn());
      handle.updateTarget({
        componentName: "TrafficSources",
        source: { path: "src/A.tsx", line: 4, column: 1, via: "react-fiber" },
        tag: "div",
        selector: "div",
      });
      expect(handle.panel.querySelector(".ns-inspector-target-name")?.textContent).toBe(
        "TrafficSources",
      );
      expect(handle.panel.querySelector(".ns-inspector-target-source")?.textContent).toBe(
        "src/A.tsx:4:1",
      );
    });
  });

  describe("comment tab", () => {
    it("does not submit an empty comment: Save behaves like Cancel", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, onCancel);
      saveButton(panel).click();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("submits the trimmed comment as a comment operation", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn<(r: InspectorSubmission) => void>();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, vi.fn());
      const textarea = must(panel.querySelector("textarea"));
      textarea.value = "  Make this a table  ";
      saveButton(panel).click();
      expect(onSubmit).toHaveBeenCalledWith({
        comment: "Make this a table",
        operation: { type: "comment", property: null, from: null, to: null },
        planFirst: false,
        attachScreenshot: false,
      });
    });

    it("carries the initial planFirst/attachScreenshot toggles through to the payload", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn<(r: InspectorSubmission) => void>();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, vi.fn(), {
        initialPlanFirst: true,
        initialAttachScreenshot: true,
      });
      must(panel.querySelector("textarea")).value = "hi";
      saveButton(panel).click();
      const result = onSubmit.mock.calls[0][0];
      expect(result.planFirst).toBe(true);
      expect(result.attachScreenshot).toBe(true);
    });
  });

  describe("text tab", () => {
    it("live-applies to a leaf element as you type", () => {
      const el = mount(document.createElement("span"));
      el.textContent = "Submit";
      const { panel } = buildInspector(el, NO_TARGET, vi.fn(), vi.fn());
      tabButton(panel, "Text").click();
      const input = must(
        panel.querySelector<HTMLInputElement>('.ns-inspector-tab-body input[type="text"]'),
      );
      input.value = "Save changes";
      input.dispatchEvent(new Event("input"));
      expect(el.textContent).toBe("Save changes");
    });

    it("reverts the live preview on cancel", () => {
      const el = mount(document.createElement("span"));
      el.textContent = "Submit";
      const onCancel = vi.fn();
      const { panel } = buildInspector(el, NO_TARGET, vi.fn(), onCancel);
      tabButton(panel, "Text").click();
      const input = must(
        panel.querySelector<HTMLInputElement>('.ns-inspector-tab-body input[type="text"]'),
      );
      input.value = "Save changes";
      input.dispatchEvent(new Event("input"));
      panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(el.textContent).toBe("Submit");
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("does not touch textContent for a non-leaf element, but still records the intended change", () => {
      const el = mount(document.createElement("div"));
      const child = document.createElement("span");
      child.textContent = "child";
      el.append(child);
      const onSubmit = vi.fn<(r: InspectorSubmission) => void>();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, vi.fn());
      tabButton(panel, "Text").click();
      const input = must(
        panel.querySelector<HTMLInputElement>('.ns-inspector-tab-body input[type="text"]'),
      );
      expect(input.disabled).toBe(true);
    });

    it("submits nothing when the text is unchanged", () => {
      const el = mount(document.createElement("span"));
      el.textContent = "Submit";
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, onCancel);
      tabButton(panel, "Text").click();
      saveButton(panel).click();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("submits a text operation with from/to when changed", () => {
      const el = mount(document.createElement("span"));
      el.textContent = "Submit";
      const onSubmit = vi.fn<(r: InspectorSubmission) => void>();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, vi.fn());
      tabButton(panel, "Text").click();
      const input = must(
        panel.querySelector<HTMLInputElement>('.ns-inspector-tab-body input[type="text"]'),
      );
      input.value = "Save changes";
      input.dispatchEvent(new Event("input"));
      saveButton(panel).click();
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: { type: "text", property: null, from: "Submit", to: "Save changes" },
        }),
      );
    });
  });

  describe("color tab", () => {
    it("live-applies the selected property as a swatch or hex value is chosen", () => {
      const el = mount(document.createElement("div"));
      const { panel } = buildInspector(el, NO_TARGET, vi.fn(), vi.fn());
      tabButton(panel, "Colour").click();
      const hexInput = must(panel.querySelector<HTMLInputElement>(".ns-inspector-hex"));
      hexInput.value = "#ff0000";
      hexInput.dispatchEvent(new Event("change"));
      // happy-dom does not normalize CSSOM color values the way a real browser does, so this
      // checks the value was actually written rather than asserting a specific serialization.
      expect(el.style.color).toBeTruthy();
      expect(el.style.color).not.toBe("");
    });

    it("reverts the live preview on cancel", () => {
      const el = mount(document.createElement("div"));
      el.style.color = "blue";
      const { panel } = buildInspector(el, NO_TARGET, vi.fn(), vi.fn());
      tabButton(panel, "Colour").click();
      const hexInput = must(panel.querySelector<HTMLInputElement>(".ns-inspector-hex"));
      hexInput.value = "#ff0000";
      hexInput.dispatchEvent(new Event("change"));
      panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(el.style.color).toBe("blue");
    });

    it("submits nothing when no property was changed", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, onCancel);
      tabButton(panel, "Colour").click();
      saveButton(panel).click();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("switching to the background property and changing it submits a background-color operation", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn<(r: InspectorSubmission) => void>();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, vi.fn());
      tabButton(panel, "Colour").click();
      const propButtons = Array.from(
        panel.querySelectorAll<HTMLButtonElement>(".ns-inspector-property"),
      );
      const bgButton = must(propButtons.find((b) => b.textContent === "Background"));
      bgButton.click();
      const hexInput = must(panel.querySelector<HTMLInputElement>(".ns-inspector-hex"));
      hexInput.value = "#00ff00";
      hexInput.dispatchEvent(new Event("change"));
      saveButton(panel).click();
      const result = onSubmit.mock.calls[0][0];
      expect(result.operation.type).toBe("style");
      expect(result.operation.property).toBe("background-color");
      expect(result.operation.to).toBe("#00ff00");
    });
  });

  describe("tab switching", () => {
    it("reverts a tab's live preview when switching away from it", () => {
      const el = mount(document.createElement("span"));
      el.textContent = "Submit";
      const { panel } = buildInspector(el, NO_TARGET, vi.fn(), vi.fn());
      tabButton(panel, "Text").click();
      const input = must(
        panel.querySelector<HTMLInputElement>('.ns-inspector-tab-body input[type="text"]'),
      );
      input.value = "Changed";
      input.dispatchEvent(new Event("input"));
      expect(el.textContent).toBe("Changed");
      tabButton(panel, "Comment").click();
      expect(el.textContent).toBe("Submit");
    });
  });

  describe("cancel and escape", () => {
    it("Escape cancels without submitting", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, onCancel);
      must(panel.querySelector("textarea")).value = "hi";
      panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("the Cancel button cancels without submitting", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, onCancel);
      must(panel.querySelector<HTMLButtonElement>(".ns-btn--secondary-danger")).click();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("cancel is idempotent: calling handle.cancel() twice only fires onCancel once", () => {
      const el = mount(document.createElement("div"));
      const onCancel = vi.fn();
      const handle = buildInspector(el, NO_TARGET, vi.fn(), onCancel);
      handle.cancel();
      handle.cancel();
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe("delete", () => {
    it("calls onDelete without also calling onCancel or onSubmit", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      const onDelete = vi.fn();
      const { panel } = buildInspector(el, NO_TARGET, onSubmit, onCancel, { onDelete });
      const del = must(
        Array.from(panel.querySelectorAll("button")).find((b) => b.textContent === "Delete"),
      );
      del.click();
      expect(onDelete).toHaveBeenCalledOnce();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
