import { resolveXPath } from "../lib/xpath.js";
import type { PinModel } from "../messages.js";
import { ICON_COLOR, ICON_TEXT, ICON_WARNING, icon } from "./icons.js";
import {
  type InspectorHandle,
  type InspectorOptions,
  type InspectorSubmission,
  type InspectorTarget,
  buildInspector,
} from "./inspector.js";
import overlayCss from "./overlay.css?inline";
import { TopLayer } from "./top-layer.js";

const OVERLAY_MARGIN = 8;
const INSPECTOR_WIDTH = 300;

interface ActivePin {
  model: PinModel;
  el: HTMLElement;
  anchor: Element | null;
}

export interface ModalAction {
  label: string;
  variant?: "danger" | "ghost";
  onClick: () => void;
}

export interface ModalOptions {
  title: string;
  body: string;
  actions: ModalAction[];
  onDismiss: () => void;
}

export type { InspectorOptions, InspectorSubmission, InspectorTarget };

export class Surface {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private pins: ActivePin[] = [];
  private hoverBox: HTMLElement | null = null;
  private selectionBox: HTMLElement | null = null;
  private selectionEl: Element | null = null;
  private inspector: InspectorHandle | null = null;
  private inspectorHighlight: HTMLElement | null = null;
  private inspectorAnchor: Element | null = null;
  private readonly topLayer = new TopLayer();
  private rafId = 0;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "northstar-root";
    this.shadow = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = overlayCss;
    this.shadow.append(style);
  }

  mount(): void {
    if (this.host.isConnected) return;
    document.documentElement.append(this.host);
    this.topLayer.attach(this.host, this.shadow);
  }

  unmount(): void {
    this.closeInspector();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.topLayer.detach();
    this.host.remove();
  }

  append(el: HTMLElement): void {
    this.mount();
    this.shadow.append(el);
  }

  ownsEvent(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  owns(el: EventTarget | null): boolean {
    return el instanceof Node && (el === this.host || this.host.contains(el as Node));
  }

  setHidden(hidden: boolean): void {
    this.host.style.visibility = hidden ? "hidden" : "";
  }

  highlightHover(target: Element | null): void {
    if (!target || target === this.selectionEl) {
      this.hoverBox?.remove();
      this.hoverBox = null;
      return;
    }
    this.mount();
    if (!this.hoverBox) {
      this.hoverBox = document.createElement("div");
      this.hoverBox.className = "ns-hover";
      this.shadow.append(this.hoverBox);
    }
    place(this.hoverBox, target);
  }

  setSelection(target: Element | null): void {
    this.selectionEl = target;
    if (!target) {
      this.selectionBox?.remove();
      this.selectionBox = null;
      return;
    }
    this.mount();
    if (!this.selectionBox) {
      this.selectionBox = document.createElement("div");
      this.selectionBox.className = "ns-selection";
      this.shadow.append(this.selectionBox);
    }
    place(this.selectionBox, target);
    this.startTicker();
  }

  selected(): Element | null {
    return this.selectionEl;
  }

  showModal(options: ModalOptions): void {
    this.mount();

    const backdrop = document.createElement("div");
    backdrop.className = "ns-modal-backdrop";

    const card = document.createElement("div");
    card.className = "ns-modal";

    const warnEl = document.createElement("div");
    warnEl.className = "ns-modal-icon";
    warnEl.append(icon(ICON_WARNING, "ns-modal-warning-icon"));
    const title = document.createElement("div");
    title.className = "ns-modal-title";
    title.textContent = options.title;
    const body = document.createElement("p");
    body.className = "ns-modal-body";
    body.textContent = options.body;
    const actions = document.createElement("div");
    actions.className = "ns-modal-actions";

    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      options.onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    for (const def of options.actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ns-btn${def.variant ? ` ns-btn--${def.variant}` : " ns-btn--secondary"}`;
      btn.textContent = def.label;
      btn.addEventListener("click", () => {
        close();
        def.onClick();
      });
      actions.append(btn);
    }

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });
    document.addEventListener("keydown", onKey, true);

    card.append(warnEl, title, body, actions);
    backdrop.append(card);
    this.shadow.append(backdrop);
  }

  // One popover for all three ways to act on an element: leave a comment, edit its text, or
  // recolour it. onSubmit fires at most once; onCancel fires on Esc, outside click, an empty
  // save, or Cancel, and any live preview (colour, text) is reverted before it fires.
  showInspector(
    target: Element,
    info: InspectorTarget,
    onSubmit: (result: InspectorSubmission) => void,
    onCancel: () => void,
    opts?: InspectorOptions,
  ): InspectorHandle {
    this.mount();
    this.closeInspector();
    this.inspectorAnchor = target;

    const highlight = document.createElement("div");
    highlight.className = "ns-highlight";

    const handle = buildInspector(
      target as HTMLElement,
      info,
      (result) => {
        this.closeInspectorDom();
        onSubmit(result);
      },
      () => {
        this.closeInspectorDom();
        onCancel();
      },
      opts,
    );

    this.inspectorHighlight = highlight;
    this.inspector = handle;
    this.shadow.append(highlight, handle.panel);
    this.reposition();
    this.startTicker();
    handle.focus();
    return handle;
  }

  setPins(
    models: PinModel[],
    onRemove: (key: string) => void,
    onEdit: (
      key: string,
      text: string,
      opts?: { planFirst?: boolean; attachScreenshot?: boolean },
    ) => void,
  ): void {
    this.mount();
    for (const pin of this.pins) pin.el.remove();

    this.pins = models.map((model) => {
      const wrap = document.createElement("div");
      wrap.dataset.key = model.key;
      const classes = ["ns-pin-wrap", `ns-pin-wrap--${model.status}`];
      if (model.status === "resolved") classes.push("ns-pin-wrap--hidden");
      wrap.className = classes.join(" ");

      const marker = document.createElement("div");
      marker.className = "ns-pin";
      const glyphEl = document.createElement("span");
      const g = glyph(model.kind);
      if (g) glyphEl.append(g);
      marker.append(glyphEl);

      const card = document.createElement("div");
      card.className = "ns-pin-card";

      const preview = document.createElement("div");
      preview.className = "ns-pin-card-preview";
      preview.textContent = model.text;
      card.append(preview);

      if (model.removable) {
        marker.style.cursor = "pointer";
        marker.addEventListener("click", (event) => {
          event.stopPropagation();
          const anchor = resolveXPath(model.operator);
          if (!anchor) return;
          this.showInspector(
            anchor,
            { componentName: null, source: null, tag: model.target, selector: model.operator },
            (result) => onEdit(model.key, result.comment, result),
            () => {},
            {
              editOnly: true,
              initialText: model.text,
              initialPlanFirst: model.planFirst,
              initialAttachScreenshot: model.hasScreenshot,
              title: "Edit comment",
              onDelete: () => onRemove(model.key),
            },
          );
        });
      }

      wrap.append(marker, card);
      this.shadow.append(wrap);
      return { model, el: wrap, anchor: resolveXPath(model.operator) };
    });
    this.reposition();
    this.startTicker();
  }

  focusPin(key: string | null): void {
    for (const pin of this.pins) {
      pin.el.classList.remove("ns-pin-wrap--focus");
    }
    if (!key) return;
    const target = this.pins.find((p) => p.model.key === key);
    if (target) target.el.classList.add("ns-pin-wrap--focus");
  }

  /** Closes the popover, reverting any live preview first. Safe to call when none is open. */
  closeInspector(): void {
    this.inspector?.cancel();
  }

  private closeInspectorDom(): void {
    this.inspector?.panel.remove();
    this.inspectorHighlight?.remove();
    this.inspector = null;
    this.inspectorHighlight = null;
    this.inspectorAnchor = null;
  }

  // Anchors (pins, the selection box, the inspector popover) ride DOM elements that can
  // move for reasons no scroll/resize event reports: transform-based scrolling,
  // animations, async layout shifts. A per-frame reconcile keeps them glued; it
  // self-stops once nothing is being tracked, so it costs nothing when idle.
  private startTicker(): void {
    if (this.rafId || !this.host.isConnected) return;
    const tick = () => {
      this.reposition();
      this.rafId = this.hasTracked() ? requestAnimationFrame(tick) : 0;
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private hasTracked(): boolean {
    return this.pins.length > 0 || this.selectionEl !== null || this.inspectorAnchor !== null;
  }

  private reposition(): void {
    for (const pin of this.pins) {
      if (!pin.anchor?.isConnected) pin.anchor = resolveXPath(pin.model.operator);
      if (!pin.anchor) {
        pin.el.style.display = "none";
        continue;
      }
      const rect = pin.anchor.getBoundingClientRect();
      pin.el.style.display = "";
      pin.el.style.left = `${rect.left}px`;
      pin.el.style.top = `${rect.top}px`;
    }

    if (this.selectionEl?.isConnected && this.selectionBox)
      place(this.selectionBox, this.selectionEl);

    if (this.inspectorAnchor && this.inspectorHighlight && this.inspector) {
      const rect = this.inspectorAnchor.getBoundingClientRect();
      place(this.inspectorHighlight, this.inspectorAnchor);
      const panelH = this.inspector.panel.offsetHeight || 320;
      const clampedLeft = Math.min(
        Math.max(OVERLAY_MARGIN, rect.left),
        window.innerWidth - INSPECTOR_WIDTH - OVERLAY_MARGIN,
      );
      const fitsBelow = rect.bottom + panelH + OVERLAY_MARGIN <= window.innerHeight;
      const topRaw = fitsBelow
        ? rect.bottom + OVERLAY_MARGIN
        : Math.max(OVERLAY_MARGIN, rect.top - panelH - OVERLAY_MARGIN);
      this.inspector.panel.style.left = `${clampedLeft}px`;
      this.inspector.panel.style.top = `${topRaw}px`;
      this.inspector.panel.classList.toggle("ns-inspector--below", fitsBelow);
      this.inspector.panel.classList.toggle("ns-inspector--above", !fitsBelow);
    }
  }
}

function place(box: HTMLElement, target: Element): void {
  const rect = target.getBoundingClientRect();
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
}

function glyph(kind: PinModel["kind"]): SVGSVGElement | null {
  if (kind === "style") return icon(ICON_COLOR, "ns-pin-glyph");
  if (kind === "text") return icon(ICON_TEXT, "ns-pin-glyph");
  return null;
}
