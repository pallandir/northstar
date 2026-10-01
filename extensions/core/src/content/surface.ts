import { pageKey } from "@northstar/protocol";
import { resolveXPath } from "../lib/xpath.js";
import type { PinModel } from "../messages.js";
import { ICON_COLOR, ICON_TEXT, ICON_WARNING, icon } from "./icons.js";
import {
  type InspectorHandle,
  type InspectorOptions,
  type InspectorSubmission,
  buildInspector,
} from "./inspector.js";
import overlayCss from "./overlay.css?inline";
import { TopLayer } from "./top-layer.js";

const OVERLAY_MARGIN = 8;
const INSPECTOR_WIDTH = 380;
const MISSING_GRACE_MS = 2000;

interface ActivePin {
  model: PinModel;
  signature: string;
  el: HTMLElement;
  anchor: Element | null;
  unresolvedSince: number | null;
  broken: boolean;
}

export interface PinEditOptions {
  planFirst?: boolean;
  attachScreenshot?: boolean;
}

export interface PinHandlers {
  onRemove: (key: string) => void;
  onEdit: (key: string, text: string, opts?: PinEditOptions) => void | Promise<void>;
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

export type { InspectorOptions, InspectorSubmission };

export class Surface {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private pins = new Map<string, ActivePin>();
  private pinHandlers: PinHandlers | null = null;
  private pinsPage = "";
  private checkedHref = "";
  private hrefOnPinsPage = true;
  private resolveObserver: MutationObserver | null = null;
  private resolveFrame = 0;
  private missingTimer = 0;
  private missingKeys = new Set<string>();
  private onMissing: ((keys: Set<string>) => void) | null = null;
  private hoverBox: HTMLElement | null = null;
  private selectionBox: HTMLElement | null = null;
  private selectionEl: Element | null = null;
  private inspector: InspectorHandle | null = null;
  private inspectorHighlight: HTMLElement | null = null;
  private inspectorAnchor: Element | null = null;
  private readonly topLayer = new TopLayer();
  private readonly modals = new Set<() => void>();
  private rafId = 0;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "northstar-root";
    this.shadow = this.host.attachShadow({ mode: "closed" });
    adoptStyles(this.shadow, overlayCss);
    for (const type of ["keydown", "keyup", "keypress"]) {
      this.host.addEventListener(type, (event) => {
        event.stopPropagation();
        if ((event as KeyboardEvent).key === "Escape") event.preventDefault();
      });
    }
  }

  mount(): void {
    if (this.host.isConnected) return;
    document.documentElement.append(this.host);
    this.topLayer.attach(this.host, this.shadow);
  }

  unmount(): void {
    this.closeInspector();
    for (const dispose of [...this.modals]) dispose();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.stopResolving();
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

  hasInspector(): boolean {
    return this.inspector !== null;
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
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");

    const warnEl = document.createElement("div");
    warnEl.className = "ns-modal-icon";
    warnEl.append(icon(ICON_WARNING, "ns-modal-warning-icon"));
    const title = document.createElement("div");
    title.className = "ns-modal-title";
    title.textContent = options.title;
    title.id = "ns-modal-title";
    const body = document.createElement("p");
    body.className = "ns-modal-body";
    body.textContent = options.body;
    body.id = "ns-modal-body";
    card.setAttribute("aria-labelledby", title.id);
    card.setAttribute("aria-describedby", body.id);
    const actions = document.createElement("div");
    actions.className = "ns-modal-actions";

    const dispose = () => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      this.modals.delete(dispose);
    };
    const close = () => {
      dispose();
      options.onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    for (const def of options.actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ns-btn${def.variant ? ` ns-btn--${def.variant}` : ""}`;
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
    this.modals.add(dispose);

    card.append(warnEl, title, body, actions);
    backdrop.append(card);
    this.shadow.append(backdrop);
    actions.querySelector("button")?.focus();
  }

  showInspector(
    target: Element,
    onSubmit: (result: InspectorSubmission) => void | Promise<void>,
    onCancel: () => void,
    opts?: InspectorOptions,
  ): InspectorHandle {
    this.mount();
    this.closeInspector();
    if (this.inspector) this.closeInspectorDom();
    this.inspectorAnchor = target;

    const highlight = document.createElement("div");
    highlight.className = "ns-highlight";

    const handle = buildInspector(
      target as HTMLElement,
      async (result) => {
        await onSubmit(result);
        this.closeInspectorDom();
      },
      () => {
        this.closeInspectorDom();
        onCancel();
      },
      opts?.onDelete
        ? {
            ...opts,
            onDelete: () => {
              this.closeInspectorDom();
              opts.onDelete?.();
            },
          }
        : opts,
    );

    this.inspectorHighlight = highlight;
    this.inspector = handle;
    this.shadow.append(highlight, handle.panel);
    this.reposition();
    this.startTicker();
    handle.focus();
    return handle;
  }

  watchMissing(callback: (keys: Set<string>) => void): void {
    this.onMissing = callback;
  }

  setPins(models: PinModel[], handlers: PinHandlers, page: string): void {
    this.mount();
    this.pinHandlers = handlers;
    this.pinsPage = page;
    const keep = new Set(models.map((model) => model.key));
    for (const [key, pin] of this.pins) {
      if (keep.has(key)) continue;
      pin.el.remove();
      this.pins.delete(key);
    }
    for (const model of models) {
      const signature = JSON.stringify({ ...model, missing: undefined });
      const existing = this.pins.get(model.key);
      if (existing?.signature === signature) {
        existing.model = model;
        continue;
      }
      existing?.el.remove();
      const pin: ActivePin = {
        model,
        signature,
        el: this.buildPin(model),
        anchor: null,
        unresolvedSince: null,
        broken: false,
      };
      this.pins.set(model.key, pin);
      this.shadow.append(pin.el);
      this.resolvePin(pin);
    }
    this.syncResolver();
    this.reposition();
    this.startTicker();
  }

  private buildPin(model: PinModel): HTMLElement {
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
        const anchor = this.pins.get(model.key)?.anchor;
        const handlers = this.pinHandlers;
        if (!anchor?.isConnected || !handlers) return;
        this.showInspector(
          anchor,
          (result) => handlers.onEdit(model.key, result.comment, result),
          () => {},
          {
            editOnly: true,
            initialText: model.text,
            initialPlanFirst: model.planFirst,
            initialAttachScreenshot: model.hasScreenshot,
            onDelete: () => handlers.onRemove(model.key),
          },
        );
      });
    }

    wrap.append(marker, card);
    return wrap;
  }

  private resolvePin(pin: ActivePin): void {
    if (pin.broken) return;
    try {
      pin.anchor = resolveXPath(pin.model.operator);
    } catch (err) {
      console.warn("[northstar] cannot locate a pin", err);
      pin.broken = true;
      pin.anchor = null;
    }
    if (pin.anchor) pin.unresolvedSince = null;
    else pin.unresolvedSince ??= Date.now();
  }

  private isUnresolved(pin: ActivePin): boolean {
    return !pin.anchor?.isConnected;
  }

  private awaiting(pin: ActivePin): boolean {
    return pin.model.status !== "resolved" && !pin.broken && this.isUnresolved(pin);
  }

  private syncResolver(): void {
    const pending = [...this.pins.values()].some((pin) => this.awaiting(pin));
    if (pending && !this.resolveObserver) {
      this.resolveObserver = new MutationObserver((records) => {
        if (records.every((record) => this.onlyHost(record))) return;
        this.scheduleResolve();
      });
      this.resolveObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["id"],
      });
      this.scheduleResolve();
    } else if (!pending) {
      this.resolveObserver?.disconnect();
      this.resolveObserver = null;
    }
    this.scheduleMissingReport();
  }

  private onlyHost(record: MutationRecord): boolean {
    if (record.type !== "childList") return false;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return nodes.length > 0 && nodes.every((node) => node === this.host);
  }

  private scheduleResolve(): void {
    if (this.resolveFrame) return;
    this.resolveFrame = requestAnimationFrame(() => {
      this.resolveFrame = 0;
      if (!this.pinsOnPage()) return;
      for (const pin of this.pins.values()) if (this.isUnresolved(pin)) this.resolvePin(pin);
      this.syncResolver();
      this.reposition();
    });
  }

  private stopResolving(): void {
    this.resolveObserver?.disconnect();
    this.resolveObserver = null;
    if (this.resolveFrame) cancelAnimationFrame(this.resolveFrame);
    this.resolveFrame = 0;
    window.clearTimeout(this.missingTimer);
    this.missingTimer = 0;
  }

  private scheduleMissingReport(): void {
    window.clearTimeout(this.missingTimer);
    this.missingTimer = 0;
    this.reportMissing();
    const waiting = [...this.pins.values()].some((pin) => this.awaiting(pin));
    if (waiting) {
      this.missingTimer = window.setTimeout(() => this.scheduleMissingReport(), MISSING_GRACE_MS);
    }
  }

  private reportMissing(): void {
    const now = Date.now();
    const keys = new Set<string>();
    for (const [key, pin] of this.pins) {
      if (pin.model.status === "resolved") continue;
      const overdue = pin.unresolvedSince !== null && now - pin.unresolvedSince >= MISSING_GRACE_MS;
      if (pin.broken || overdue) keys.add(key);
    }
    const same =
      keys.size === this.missingKeys.size && [...keys].every((k) => this.missingKeys.has(k));
    if (same) return;
    this.missingKeys = keys;
    this.onMissing?.(keys);
  }

  private pinsOnPage(): boolean {
    if (location.href !== this.checkedHref) {
      this.checkedHref = location.href;
      this.hrefOnPinsPage = this.pinsPage === "" || pageKey(location.href) === this.pinsPage;
    }
    return this.hrefOnPinsPage;
  }

  focusPin(key: string | null): void {
    for (const pin of this.pins.values()) {
      pin.el.classList.remove("ns-pin-wrap--focus");
    }
    if (!key) return;
    this.pins.get(key)?.el.classList.add("ns-pin-wrap--focus");
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

  private startTicker(): void {
    if (this.rafId || !this.host.isConnected) return;
    const tick = () => {
      this.reposition();
      this.rafId = this.hasTracked() ? requestAnimationFrame(tick) : 0;
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private hasTracked(): boolean {
    return this.pins.size > 0 || this.selectionEl !== null || this.inspectorAnchor !== null;
  }

  private reposition(): void {
    const writes: Array<() => void> = [];
    const onPage = this.pinsOnPage();
    let detached = false;

    for (const pin of this.pins.values()) {
      if (pin.model.status === "resolved") continue;
      if (!onPage || this.isUnresolved(pin)) {
        if (onPage && pin.anchor) {
          pin.anchor = null;
          pin.unresolvedSince ??= Date.now();
          detached = true;
        }
        writes.push(() => {
          pin.el.style.display = "none";
        });
        continue;
      }
      const rect = (pin.anchor as Element).getBoundingClientRect();
      writes.push(() => {
        pin.el.style.display = "";
        pin.el.style.left = `${rect.left}px`;
        pin.el.style.top = `${rect.top}px`;
      });
    }

    if (this.selectionEl?.isConnected && this.selectionBox) {
      const box = this.selectionBox;
      const rect = this.selectionEl.getBoundingClientRect();
      writes.push(() => placeBox(box, rect));
    }

    if (this.inspectorAnchor && this.inspectorHighlight && this.inspector) {
      const highlight = this.inspectorHighlight;
      const panel = this.inspector.panel;
      const rect = this.inspectorAnchor.getBoundingClientRect();
      const panelH = Math.min(panel.offsetHeight || 320, window.innerHeight - OVERLAY_MARGIN * 2);
      const panelW = panel.offsetWidth || INSPECTOR_WIDTH;
      const maxLeft = window.innerWidth - panelW - OVERLAY_MARGIN;
      const left = Math.max(OVERLAY_MARGIN, Math.min(rect.left, maxLeft));
      const fitsBelow = rect.bottom + panelH + OVERLAY_MARGIN <= window.innerHeight;
      const maxTop = window.innerHeight - panelH - OVERLAY_MARGIN;
      const top = fitsBelow ? rect.bottom + OVERLAY_MARGIN : rect.top - panelH - OVERLAY_MARGIN;
      writes.push(() => {
        placeBox(highlight, rect);
        panel.style.left = `${left}px`;
        panel.style.top = `${Math.max(OVERLAY_MARGIN, Math.min(top, maxTop))}px`;
      });
    }

    for (const write of writes) write();
    if (detached) this.syncResolver();
  }
}

function place(box: HTMLElement, target: Element): void {
  placeBox(box, target.getBoundingClientRect());
}

function placeBox(box: HTMLElement, rect: DOMRect): void {
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

function adoptStyles(shadow: ShadowRoot, css: string): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  shadow.adoptedStyleSheets = [sheet];
}
