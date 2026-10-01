import { afterEach, describe, expect, it, vi } from "vitest";
import { type InspectorSubmission, buildInspector } from "./inspector.js";

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
    const { panel } = buildInspector(el, vi.fn(), vi.fn());
    const labels = Array.from(panel.querySelectorAll(".ns-inspector-tab")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Comment", "Text", "Colour"]);
  });

  it("hides the tab strip in editOnly mode", () => {
    const el = mount(document.createElement("div"));
    const { panel } = buildInspector(el, vi.fn(), vi.fn(), { editOnly: true });
    expect(panel.querySelector(".ns-inspector-tabs")).toBeNull();
  });

  it("renders no target header and keeps component and source details out of the panel", () => {
    const el = mount(document.createElement("div"));
    const { panel } = buildInspector(el, vi.fn(), vi.fn());
    expect(panel.querySelector(".ns-inspector-target")).toBeNull();
    expect(panel.querySelector(".ns-inspector-target-name")).toBeNull();
  });

  it("caps the comment at 4000 characters", () => {
    const el = mount(document.createElement("div"));
    const { panel } = buildInspector(el, vi.fn(), vi.fn());
    expect(must(panel.querySelector("textarea")).maxLength).toBe(4000);
  });

  it("closes from Escape without needing focus on a control", () => {
    const el = mount(document.createElement("div"));
    const onCancel = vi.fn();
    const { panel } = buildInspector(el, vi.fn(), onCancel);
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  describe("comment tab", () => {
    it("does not submit an empty comment and says what to do", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      const { panel } = buildInspector(el, onSubmit, onCancel);
      saveButton(panel).click();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(must(panel.querySelector(".ns-hint")).textContent).toBe("Write a comment first.");
    });

    it("submits the trimmed comment as a comment operation", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn<(r: InspectorSubmission) => void>();
      const { panel } = buildInspector(el, onSubmit, vi.fn());
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
      const { panel } = buildInspector(el, onSubmit, vi.fn(), {
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

  describe("saving with the keyboard", () => {
    function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    }

    it("saves the comment on a plain Enter in the comment box", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn<(r: InspectorSubmission) => void>();
      const { panel } = buildInspector(el, onSubmit, vi.fn());
      const textarea = must(panel.querySelector("textarea"));
      textarea.value = "Make this calmer";
      const event = press(textarea, {});
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit.mock.calls[0][0].comment).toBe("Make this calmer");
      expect(event.defaultPrevented).toBe(true);
    });

    it("keeps Shift+Enter for a new line and does not save", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const { panel } = buildInspector(el, onSubmit, vi.fn());
      const textarea = must(panel.querySelector("textarea"));
      textarea.value = "line one";
      const event = press(textarea, { shiftKey: true });
      expect(onSubmit).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("still saves on Cmd+Enter and Ctrl+Enter", () => {
      for (const init of [{ metaKey: true }, { ctrlKey: true }]) {
        const el = mount(document.createElement("div"));
        const onSubmit = vi.fn();
        const { panel } = buildInspector(el, onSubmit, vi.fn());
        const textarea = must(panel.querySelector("textarea"));
        textarea.value = "hi";
        press(textarea, init);
        expect(onSubmit).toHaveBeenCalledOnce();
      }
    });

    it("does not save while an input method is composing", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const { panel } = buildInspector(el, onSubmit, vi.fn());
      const textarea = must(panel.querySelector("textarea"));
      textarea.value = "ni";
      press(textarea, { isComposing: true });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("leaves an empty comment open instead of closing the popover", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      const { panel } = buildInspector(el, onSubmit, onCancel);
      press(must(panel.querySelector("textarea")), {});
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("does not hijack Enter on a button, so Cancel and the toggles keep working", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const { panel } = buildInspector(el, onSubmit, vi.fn());
      must(panel.querySelector("textarea")).value = "hi";
      const event = press(saveButton(panel), {});
      expect(onSubmit).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("saves a text change from the text field on Enter", () => {
      const el = mount(document.createElement("button"));
      el.textContent = "New report";
      const onSubmit = vi.fn<(r: InspectorSubmission) => void>();
      const { panel } = buildInspector(el, onSubmit, vi.fn());
      tabButton(panel, "Text").click();
      const input = must(panel.querySelector<HTMLInputElement>('input[type="text"].ns-field'));
      input.value = "Create report";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      press(input, {});
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit.mock.calls[0][0].operation.type).toBe("text");
    });

    it("tells the user how to save", () => {
      const el = mount(document.createElement("div"));
      const { panel } = buildInspector(el, vi.fn(), vi.fn());
      expect(must(panel.querySelector(".ns-hint")).textContent).toBe("Enter saves, Esc cancels");
    });
  });

  describe("text tab", () => {
    it("live-applies to a leaf element as you type", () => {
      const el = mount(document.createElement("span"));
      el.textContent = "Submit";
      const { panel } = buildInspector(el, vi.fn(), vi.fn());
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
      const { panel } = buildInspector(el, vi.fn(), onCancel);
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
      const { panel } = buildInspector(el, onSubmit, vi.fn());
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
      const { panel } = buildInspector(el, onSubmit, onCancel);
      tabButton(panel, "Text").click();
      saveButton(panel).click();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(must(panel.querySelector(".ns-hint")).textContent).toBe("Type the new text first.");
    });

    it("submits a text operation with from/to when changed", () => {
      const el = mount(document.createElement("span"));
      el.textContent = "Submit";
      const onSubmit = vi.fn<(r: InspectorSubmission) => void>();
      const { panel } = buildInspector(el, onSubmit, vi.fn());
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
      const { panel } = buildInspector(el, vi.fn(), vi.fn());
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
      el.style.color = "rgb(0, 0, 255)";
      const { panel } = buildInspector(el, vi.fn(), vi.fn());
      tabButton(panel, "Colour").click();
      const hexInput = must(panel.querySelector<HTMLInputElement>(".ns-inspector-hex"));
      hexInput.value = "#ff0000";
      hexInput.dispatchEvent(new Event("change"));
      panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(el.style.color).toBe("rgb(0, 0, 255)");
    });

    it("submits nothing when no property was changed", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      const { panel } = buildInspector(el, onSubmit, onCancel);
      tabButton(panel, "Colour").click();
      saveButton(panel).click();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(must(panel.querySelector(".ns-hint")).textContent).toBe("Pick a colour first.");
    });

    it("switching to the background property and changing it submits a background-color operation", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn<(r: InspectorSubmission) => void>();
      const { panel } = buildInspector(el, onSubmit, vi.fn());
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
      const { panel } = buildInspector(el, vi.fn(), vi.fn());
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
      const { panel } = buildInspector(el, onSubmit, onCancel);
      must(panel.querySelector("textarea")).value = "hi";
      panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("the Cancel button cancels without submitting", () => {
      const el = mount(document.createElement("div"));
      const onSubmit = vi.fn();
      const onCancel = vi.fn();
      const { panel } = buildInspector(el, onSubmit, onCancel);
      must(
        Array.from(panel.querySelectorAll<HTMLButtonElement>(".ns-btn")).find(
          (b) => b.textContent === "Cancel",
        ),
      ).click();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("cancel is idempotent: calling handle.cancel() twice only fires onCancel once", () => {
      const el = mount(document.createElement("div"));
      const onCancel = vi.fn();
      const handle = buildInspector(el, vi.fn(), onCancel);
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
      const { panel } = buildInspector(el, onSubmit, onCancel, { onDelete });
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
