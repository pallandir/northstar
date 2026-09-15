import { rgbToHex, samplePageColors, toHex } from "../lib/color.js";
import type { Operation, SourceLocation } from "../types.js";

export type InspectorTabId = "comment" | "text" | "color";

// Deliberately narrower than the full Target/ComponentInfo wire shape: this is only what the
// header needs to display, so an edit reopened from an existing pin (which never re-probes) can
// build one from its saved label without fabricating the rest of a Target object.
export interface InspectorTarget {
  componentName: string | null;
  source: SourceLocation | null;
  tag: string | null;
  selector: string;
}

export interface InspectorSubmission {
  comment: string;
  operation: Operation;
  planFirst: boolean;
  attachScreenshot: boolean;
}

export interface InspectorOptions {
  title?: string;
  editOnly?: boolean;
  initialText?: string;
  initialPlanFirst?: boolean;
  initialAttachScreenshot?: boolean;
  onDelete?: () => void;
}

export interface InspectorHandle {
  panel: HTMLElement;
  focus: () => void;
  /** Reverts any live preview (a colour or text change applied to the element) and tears down. */
  cancel: () => void;
  /** Refreshes the header once the (asynchronous) probe answers after the panel already opened. */
  updateTarget: (info: InspectorTarget) => void;
}

interface TabController {
  id: InspectorTabId;
  label: string;
  body: HTMLElement;
  /** Called whenever this tab becomes the active one, including the first time; focuses its
   *  primary control. */
  activate: () => void;
  deactivate: () => void;
  /** null means this tab has nothing to save. */
  collect: () => { comment: string; operation: Operation } | null;
}

const COLOR_PROPERTIES = [
  { key: "color", label: "Text" },
  { key: "background-color", label: "Background" },
  { key: "border-color", label: "Border" },
] as const;

export function buildInspector(
  el: HTMLElement,
  info: InspectorTarget,
  onSubmit: (result: InspectorSubmission) => void,
  onCancel: () => void,
  opts: InspectorOptions = {},
): InspectorHandle {
  let planFirst = opts.initialPlanFirst ?? false;
  let attachScreenshot = opts.initialAttachScreenshot ?? false;

  const panel = document.createElement("div");
  panel.className = "cc-panel cc-inspector";

  const header = buildTargetHeader(info);
  panel.append(header.el);

  const bodyHost = document.createElement("div");
  bodyHost.className = "cc-inspector-body";

  const commentTab = buildCommentTab(opts.initialText);
  const textTab = buildTextTab(el);
  const colorTab = buildColorTab(el);
  const tabs: TabController[] = opts.editOnly ? [commentTab] : [commentTab, textTab, colorTab];

  let active: TabController = tabs[0];

  const tabStrip = document.createElement("div");
  tabStrip.className = "cc-inspector-tabs";
  tabStrip.setAttribute("role", "tablist");
  const tabButtons = new Map<InspectorTabId, HTMLButtonElement>();

  function selectTab(next: TabController): void {
    if (next !== active) active.deactivate();
    active = next;
    for (const [id, btn] of tabButtons) {
      const isActive = id === next.id;
      btn.classList.toggle("cc-inspector-tab--active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    }
    bodyHost.replaceChildren(next.body);
    next.activate();
  }

  if (!opts.editOnly) {
    for (const tab of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cc-inspector-tab";
      btn.setAttribute("role", "tab");
      btn.textContent = tab.label;
      btn.addEventListener("click", () => selectTab(tab));
      tabButtons.set(tab.id, btn);
      tabStrip.append(btn);
    }
    tabStrip.addEventListener("keydown", (event) => {
      const idx = tabs.indexOf(active);
      if (event.key === "ArrowRight") selectTab(tabs[(idx + 1) % tabs.length]);
      else if (event.key === "ArrowLeft") selectTab(tabs[(idx - 1 + tabs.length) % tabs.length]);
    });
    panel.append(tabStrip);
  }

  panel.append(bodyHost);
  selectTab(active);

  const footer = document.createElement("div");
  footer.className = "cc-inspector-footer";

  const toggleRow = document.createElement("div");
  toggleRow.className = "cc-toggle-row";
  const screenshotToggle = buildToggle("Attach screenshot", attachScreenshot, (value) => {
    attachScreenshot = value;
  });
  toggleRow.append(screenshotToggle);
  if (!opts.editOnly) {
    const planToggle = buildToggle("Plan as a separate task", planFirst, (value) => {
      planFirst = value;
    });
    toggleRow.append(planToggle);
  }

  const actions = document.createElement("div");
  actions.className = "cc-actions";
  const hint = document.createElement("div");
  hint.className = "cc-hint";
  hint.textContent = "Esc to cancel";
  actions.append(hint);

  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    for (const tab of tabs) tab.deactivate();
    onCancel();
  };

  if (opts.onDelete) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "cc-btn cc-btn--ghost";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      cancelled = true;
      for (const tab of tabs) tab.deactivate();
      opts.onDelete?.();
    });
    actions.append(del);
  }

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "cc-btn cc-btn--secondary-danger";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", cancel);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "cc-btn cc-btn--primary";
  saveBtn.textContent = "Save";
  const submit = () => {
    const collected = active.collect();
    if (!collected) return cancel();
    cancelled = true;
    onSubmit({ ...collected, planFirst, attachScreenshot });
  };
  saveBtn.addEventListener("click", submit);

  actions.append(cancelBtn, saveBtn);
  footer.append(toggleRow, actions);
  panel.append(footer);

  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  });

  return {
    panel,
    focus: () => active.activate(),
    cancel,
    updateTarget: header.update,
  };
}

function buildTargetHeader(initial: InspectorTarget): {
  el: HTMLElement;
  update: (info: InspectorTarget) => void;
} {
  const el = document.createElement("div");
  el.className = "cc-inspector-target";

  const name = document.createElement("div");
  name.className = "cc-inspector-target-name";
  const source = document.createElement("div");
  source.className = "cc-inspector-target-source";
  const selector = document.createElement("div");
  selector.className = "cc-inspector-target-selector";
  el.append(name, source, selector);

  const update = (info: InspectorTarget) => {
    name.textContent = info.componentName ?? info.tag ?? "Not resolved";
    if (info.source) {
      source.textContent = `${info.source.path}:${info.source.line}:${info.source.column}`;
      source.hidden = false;
    } else {
      source.hidden = true;
    }
    selector.textContent = info.selector;
    selector.hidden = !info.selector;
  };
  update(initial);

  return { el, update };
}

function buildCommentTab(initialText?: string): TabController {
  const body = document.createElement("div");
  body.className = "cc-inspector-tab-body";
  const textarea = document.createElement("textarea");
  textarea.placeholder = "What should your AI assistant change here?";
  textarea.value = initialText ?? "";
  body.append(textarea);

  return {
    id: "comment",
    label: "Comment",
    body,
    activate: () => textarea.focus(),
    deactivate: () => {},
    collect: () => {
      const value = textarea.value.trim();
      if (!value) return null;
      return {
        comment: value,
        operation: { type: "comment", property: null, from: null, to: null },
      };
    },
  };
}

function buildTextTab(el: HTMLElement): TabController {
  const body = document.createElement("div");
  body.className = "cc-inspector-tab-body";

  const isLeaf = el.children.length === 0;
  const originalNodes = Array.from(el.childNodes).map((node) => node.cloneNode(true));
  const from = (el.textContent ?? "").trim();

  const current = document.createElement("div");
  current.className = "cc-inspector-current-text";
  current.textContent = from || "(empty)";

  const input = document.createElement("input");
  input.type = "text";
  input.value = from;
  input.placeholder = "New text";
  if (!isLeaf) {
    input.disabled = true;
    input.title = "This element has child elements, so its text cannot be previewed live";
  }

  let applied = false;
  input.addEventListener("input", () => {
    if (!isLeaf) return;
    el.textContent = input.value;
    applied = true;
  });

  body.append(current, input);

  const revert = () => {
    if (!applied) return;
    el.replaceChildren(...originalNodes.map((node) => node.cloneNode(true)));
    applied = false;
  };

  return {
    id: "text",
    label: "Text",
    body,
    activate: () => input.focus(),
    deactivate: revert,
    collect: () => {
      const to = input.value.trim();
      if (!to || to === from) {
        revert();
        return null;
      }
      if (!isLeaf) revert(); // never leave a non-leaf element half-mutated
      return {
        comment: from ? `Change text from "${from}" to "${to}"` : `Set text to "${to}"`,
        operation: { type: "text", property: null, from, to },
      };
    },
  };
}

function buildColorTab(el: HTMLElement): TabController {
  const body = document.createElement("div");
  body.className = "cc-inspector-tab-body";

  const computed = getComputedStyle(el);
  const originals: Record<string, string> = {
    color: el.style.color,
    "background-color": el.style.backgroundColor,
    "border-color": el.style.borderColor,
  };
  const from: Record<string, string> = {
    color: computed.color,
    "background-color": computed.backgroundColor,
    "border-color": computed.borderColor,
  };
  const changed: Record<string, string> = {};

  let property: (typeof COLOR_PROPERTIES)[number]["key"] = "color";

  const propertyRow = document.createElement("div");
  propertyRow.className = "cc-inspector-property-row";
  const propertyButtons = new Map<string, HTMLButtonElement>();
  for (const p of COLOR_PROPERTIES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cc-inspector-property";
    btn.textContent = p.label;
    btn.addEventListener("click", () => {
      property = p.key;
      syncControls();
    });
    propertyButtons.set(p.key, btn);
    propertyRow.append(btn);
  }

  const swatchRow = document.createElement("div");
  swatchRow.className = "cc-inspector-swatches";
  for (const hex of samplePageColors(el)) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "cc-inspector-swatch";
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.addEventListener("click", () => applyColor(hex));
    swatchRow.append(swatch);
  }

  const controlsRow = document.createElement("div");
  controlsRow.className = "cc-inspector-color-controls";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.className = "cc-inspector-hex";
  controlsRow.append(colorInput, hexInput);

  function syncControls(): void {
    for (const [key, btn] of propertyButtons) {
      btn.classList.toggle("cc-inspector-property--active", key === property);
    }
    const value = toHex(changed[property] ?? from[property]);
    colorInput.value = value;
    hexInput.value = value;
  }

  function applyColor(hex: string): void {
    changed[property] = hex;
    (el.style as unknown as Record<string, string>)[toCamel(property)] = hex;
    syncControls();
  }

  colorInput.addEventListener("input", () => applyColor(colorInput.value));
  hexInput.addEventListener("change", () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) applyColor(hexInput.value);
    else syncControls();
  });

  syncControls();
  body.append(propertyRow, swatchRow, controlsRow);

  const revert = () => {
    for (const [key, value] of Object.entries(originals)) {
      (el.style as unknown as Record<string, string>)[toCamel(key)] = value;
    }
  };

  return {
    id: "color",
    label: "Colour",
    body,
    activate: () => {},
    deactivate: revert,
    collect: () => {
      const touched = Object.keys(changed).filter(
        (key) => toHex(changed[key]) !== toHex(from[key]),
      );
      if (touched.length === 0) {
        revert();
        return null;
      }
      const summary = touched
        .map((key) => `${propertyName(key)} from ${toHex(from[key])} to ${toHex(changed[key])}`)
        .join(" and ");
      const primary = touched[touched.length - 1];
      return {
        comment: `Change ${summary}`,
        operation: {
          type: "style",
          property: primary,
          from: rgbToHex(from[primary]),
          to: toHex(changed[primary]),
        },
      };
    },
  };
}

function propertyName(key: string): string {
  const found = COLOR_PROPERTIES.find((p) => p.key === key);
  return found ? found.label.toLowerCase() : key;
}

function toCamel(cssProperty: string): string {
  return cssProperty.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function buildToggle(
  label: string,
  initial: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  let value = initial;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cc-toggle";
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-pressed", String(value));
  const labelEl = document.createElement("span");
  labelEl.className = "cc-toggle-label";
  labelEl.textContent = label;
  const track = document.createElement("span");
  track.className = "cc-switch";
  btn.append(labelEl, track);
  btn.addEventListener("click", () => {
    value = !value;
    btn.setAttribute("aria-pressed", String(value));
    onChange(value);
  });
  return btn;
}
