import type { Operation } from "../types.js";
import { ICON_RESET, icon } from "./icons.js";
import type { Surface } from "./surface.js";

const OVERLAY_MARGIN = 8;

export function openColorPanel(
  surface: Surface,
  el: HTMLElement,
  commit: (operation: Operation, summary: string) => void,
  cancel: () => void,
): void {
  const computed = getComputedStyle(el);
  const fromColor = computed.color;
  const fromBg = computed.backgroundColor;
  const originalInline = { color: el.style.color, background: el.style.backgroundColor };

  const panel = document.createElement("div");
  panel.className = "cc-tool-panel";

  const colorInput = field(panel, "Text color", rgbToHex(fromColor), (hex) => {
    el.style.color = hex;
  });
  const bgInput = field(panel, "Background", rgbToHex(fromBg), (hex) => {
    el.style.backgroundColor = hex;
  });

  const actions = document.createElement("div");
  actions.className = "cc-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "cc-btn cc-btn--primary";
  save.textContent = "Save";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "cc-btn cc-btn--secondary";
  close.textContent = "Cancel";
  actions.append(close, save);
  panel.append(actions);

  const teardown = () => panel.remove();
  close.addEventListener("click", () => {
    el.style.color = originalInline.color;
    el.style.backgroundColor = originalInline.background;
    teardown();
    cancel();
  });
  save.addEventListener("click", () => {
    const colorChanged = Boolean(colorInput.value) && rgbToHex(fromColor) !== colorInput.value;
    const bgChanged = Boolean(bgInput.value) && rgbToHex(fromBg) !== bgInput.value;
    teardown();
    if (!colorChanged && !bgChanged) {
      cancel();
      return;
    }
    const primary = colorChanged
      ? { property: "color", from: fromColor, to: colorInput.value }
      : { property: "background-color", from: fromBg, to: bgInput.value };
    const operation: Operation = {
      type: "style",
      property: primary.property,
      from: primary.from,
      to: primary.to,
    };
    const summary = describeChanges(
      colorChanged,
      bgChanged,
      fromColor,
      colorInput.value,
      fromBg,
      bgInput.value,
    );
    commit(operation, summary);
  });

  surface.append(panel);
  positionNear(panel, el);
}

export function openTextEditor(
  surface: Surface,
  el: HTMLElement,
  commit: (from: string, to: string) => void,
  cancel: () => void,
): void {
  const originalNodes = Array.from(el.childNodes).map((node) => node.cloneNode(true));
  const originalText = el.textContent ?? "";
  const from = originalText.trim();
  const isLeaf = el.children.length === 0;

  const hint = document.createElement("div");
  hint.className = "cc-tool-hint";
  hint.textContent = "Enter to save · Esc to cancel";
  surface.append(hint);
  positionNear(hint, el);

  el.setAttribute("contenteditable", "true");
  el.focus();
  selectAll(el);

  let done = false;
  const restore = () => el.replaceChildren(...originalNodes.map((node) => node.cloneNode(true)));
  const cleanup = () => {
    el.removeEventListener("keydown", onKey);
    el.removeEventListener("blur", onBlur);
    document.removeEventListener("pointerdown", onOutside, true);
    el.removeAttribute("contenteditable");
    hint.remove();
  };
  const finish = (saveIt: boolean) => {
    if (done) return;
    done = true;
    cleanup();
    const to = (el.textContent ?? "").trim();
    if (saveIt && to && to !== from) {
      if (!isLeaf) restore();
      commit(from, to);
    } else {
      restore();
      cancel();
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };
  const onBlur = () => finish(true);
  const onOutside = (event: Event) => {
    const target = event.target as Node | null;
    if (target && !el.contains(target)) finish(true);
  };
  el.addEventListener("keydown", onKey);
  el.addEventListener("blur", onBlur, { once: true });
  document.addEventListener("pointerdown", onOutside, true);
}

function field(
  panel: HTMLElement,
  label: string,
  hex: string,
  onInput: (hex: string) => void,
): HTMLInputElement {
  const row = document.createElement("label");
  row.className = "cc-field";
  const span = document.createElement("span");
  span.textContent = label;

  const input = document.createElement("input");
  input.type = "color";
  input.value = hex;

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "cc-field-reset cc-has-tip";
  resetBtn.dataset.tip = "Reset to original";
  resetBtn.disabled = true;
  resetBtn.append(icon(ICON_RESET, "cc-field-reset-icon"));

  const syncReset = () => {
    resetBtn.disabled = input.value.toLowerCase() === hex.toLowerCase();
  };

  input.addEventListener("input", () => {
    onInput(input.value);
    syncReset();
  });
  resetBtn.addEventListener("click", () => {
    input.value = hex;
    onInput(hex);
    syncReset();
  });

  const controls = document.createElement("div");
  controls.className = "cc-field-controls";
  controls.append(input, resetBtn);
  row.append(span, controls);
  panel.append(row);
  return input;
}

function positionNear(box: HTMLElement, el: Element): void {
  const rect = el.getBoundingClientRect();
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const left = Math.min(
    Math.max(rect.left, OVERLAY_MARGIN),
    window.innerWidth - w - OVERLAY_MARGIN,
  );
  const belowTop = rect.bottom + OVERLAY_MARGIN;
  const aboveTop = rect.top - h - OVERLAY_MARGIN;
  let top =
    belowTop + h > window.innerHeight - OVERLAY_MARGIN && aboveTop >= OVERLAY_MARGIN
      ? aboveTop
      : belowTop;
  top = Math.min(Math.max(top, OVERLAY_MARGIN), window.innerHeight - h - OVERLAY_MARGIN);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

function selectAll(el: Element): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function describeChanges(
  colorChanged: boolean,
  bgChanged: boolean,
  fromColor: string,
  toColor: string,
  fromBg: string,
  toBg: string,
): string {
  const parts: string[] = [];
  if (colorChanged) parts.push(`text color from ${toHex(fromColor)} to ${toHex(toColor)}`);
  if (bgChanged) parts.push(`background from ${toHex(fromBg)} to ${toHex(toBg)}`);
  return `Change ${parts.join(" and ")}`;
}

function toHex(value: string): string {
  return value.startsWith("#") ? value.toLowerCase() : rgbToHex(value);
}

function rgbToHex(rgb: string): string {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return "#000000";
  const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${hex(match[1])}${hex(match[2])}${hex(match[3])}`;
}
