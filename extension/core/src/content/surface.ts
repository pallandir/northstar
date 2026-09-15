import { resolveXPath } from "../lib/xpath.js";
import type { PinModel } from "../messages.js";
import { ICON_COLOR, ICON_COMMENT, ICON_TEXT, ICON_WARNING, icon } from "./icons.js";
import overlayCss from "./overlay.css?inline";
import { TopLayer } from "./top-layer.js";

const OVERLAY_MARGIN = 8;
const COMPOSER_WIDTH = 264;

interface ActivePin {
  model: PinModel;
  el: HTMLElement;
  anchor: Element | null;
}

export interface ActionMenuHandlers {
  onComment: () => void;
  onColor: () => void;
  onText: () => void;
  onDismiss: () => void;
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

export interface ComposerOptions {
  initialText?: string;
  initialPlanFirst?: boolean;
  initialAttachScreenshot?: boolean;
  title?: string;
  onDelete?: () => void;
}

export class Surface {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private pins: ActivePin[] = [];
  private hoverBox: HTMLElement | null = null;
  private selectionBox: HTMLElement | null = null;
  private selectionEl: Element | null = null;
  private composer: HTMLElement | null = null;
  private composerHighlight: HTMLElement | null = null;
  private composerAnchor: Element | null = null;
  private actionMenu: HTMLElement | null = null;
  private actionCleanup: (() => void) | null = null;
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
    this.closeActionMenu();
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
      this.hoverBox.className = "cc-hover";
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
      this.selectionBox.className = "cc-selection";
      this.shadow.append(this.selectionBox);
    }
    place(this.selectionBox, target);
    this.startTicker();
  }

  selected(): Element | null {
    return this.selectionEl;
  }

  showActionMenu(target: Element, handlers: ActionMenuHandlers): void {
    this.mount();
    this.closeActionMenu();

    const menu = document.createElement("div");
    menu.className = "cc-actions-menu";
    menu.append(
      menuButton(icon(ICON_COMMENT, "cc-menu-icon"), "Comment", handlers.onComment),
      menuButton(icon(ICON_COLOR, "cc-menu-icon"), "Color", handlers.onColor),
      menuButton(icon(ICON_TEXT, "cc-menu-icon"), "Text", handlers.onText),
    );
    this.actionMenu = menu;
    this.shadow.append(menu);

    const rect = target.getBoundingClientRect();
    const menuW = menu.offsetWidth || 188;
    const menuH = menu.offsetHeight || 60;
    const above = rect.top - menuH - 10;
    const below = rect.bottom + 10;
    const preferAbove = above > 8;
    const topRaw = preferAbove ? above : below;
    const clampedTop = Math.min(
      Math.max(OVERLAY_MARGIN, topRaw),
      window.innerHeight - menuH - OVERLAY_MARGIN,
    );
    const clampedLeft = Math.min(
      Math.max(OVERLAY_MARGIN, rect.left),
      window.innerWidth - menuW - OVERLAY_MARGIN,
    );
    menu.style.top = `${clampedTop}px`;
    menu.style.left = `${clampedLeft}px`;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        this.closeActionMenu();
        handlers.onDismiss();
      }
    };
    const onDoc = (event: Event) => {
      if (event.composedPath().includes(menu)) return;
      this.closeActionMenu();
      handlers.onDismiss();
    };
    setTimeout(() => {
      document.addEventListener("keydown", onKey, true);
      document.addEventListener("click", onDoc, true);
    }, 0);
    this.actionCleanup = () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onDoc, true);
    };
  }

  closeActionMenu(): void {
    this.actionCleanup?.();
    this.actionCleanup = null;
    this.actionMenu?.remove();
    this.actionMenu = null;
  }

  showModal(options: ModalOptions): void {
    this.mount();

    const backdrop = document.createElement("div");
    backdrop.className = "cc-modal-backdrop";

    const card = document.createElement("div");
    card.className = "cc-modal";

    const warnEl = document.createElement("div");
    warnEl.className = "cc-modal-icon";
    warnEl.append(icon(ICON_WARNING, "cc-modal-warning-icon"));
    const title = document.createElement("div");
    title.className = "cc-modal-title";
    title.textContent = options.title;
    const body = document.createElement("p");
    body.className = "cc-modal-body";
    body.textContent = options.body;
    const actions = document.createElement("div");
    actions.className = "cc-modal-actions";

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
      btn.className = `cc-modal-btn${def.variant ? ` cc-modal-btn--${def.variant}` : ""}`;
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

  showComposer(
    target: Element,
    onSubmit: (
      text: string,
      options: { planFirst: boolean; attachScreenshot: boolean },
    ) => Promise<void> | void,
    onCancel?: () => void,
    opts?: ComposerOptions,
  ): void {
    this.mount();
    this.closeComposer();
    this.composerAnchor = target;

    let planFirst = opts?.initialPlanFirst ?? false;
    let attachScreenshot = opts?.initialAttachScreenshot ?? false;

    const highlight = document.createElement("div");
    highlight.className = "cc-highlight";

    const panel = document.createElement("div");
    panel.className = "cc-panel";

    const head = document.createElement("div");
    head.className = "cc-panel-head";
    head.textContent = opts?.title ?? "Add comment";

    const textarea = document.createElement("textarea");
    textarea.placeholder = "What should your AI assistant change here?";
    textarea.value = opts?.initialText ?? "";

    const toggleRow = document.createElement("div");
    toggleRow.className = "cc-toggle-row";

    const screenshotBtn = document.createElement("button");
    screenshotBtn.type = "button";
    screenshotBtn.className = "cc-toggle";
    screenshotBtn.setAttribute("role", "switch");
    screenshotBtn.setAttribute("aria-pressed", String(attachScreenshot));
    const screenshotLabel = document.createElement("span");
    screenshotLabel.className = "cc-toggle-label";
    screenshotLabel.textContent = "Attach screenshot";
    const screenshotTrack = document.createElement("span");
    screenshotTrack.className = "cc-switch";
    screenshotBtn.append(screenshotLabel, screenshotTrack);
    screenshotBtn.addEventListener("click", () => {
      attachScreenshot = !attachScreenshot;
      screenshotBtn.setAttribute("aria-pressed", String(attachScreenshot));
    });

    const planBtn = document.createElement("button");
    planBtn.type = "button";
    planBtn.className = "cc-toggle";
    planBtn.setAttribute("role", "switch");
    planBtn.setAttribute("aria-pressed", String(planFirst));
    const planLabel = document.createElement("span");
    planLabel.className = "cc-toggle-label";
    planLabel.textContent = "Plan as a separate task";
    const planTrack = document.createElement("span");
    planTrack.className = "cc-switch";
    planBtn.append(planLabel, planTrack);
    planBtn.addEventListener("click", () => {
      planFirst = !planFirst;
      planBtn.setAttribute("aria-pressed", String(planFirst));
    });

    toggleRow.append(screenshotBtn, planBtn);

    const hint = document.createElement("div");
    hint.className = "cc-hint";
    hint.textContent = "Shift+Enter for new line";

    const actions = document.createElement("div");
    actions.className = "cc-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "cc-btn cc-btn--primary";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cc-btn cc-btn--secondary-danger";
    cancel.textContent = "Cancel";

    const dismiss = () => {
      this.closeComposer();
      onCancel?.();
    };
    const submit = async () => {
      const value = textarea.value.trim();
      if (!value) return dismiss();
      this.closeComposer();
      await onSubmit(value, { planFirst, attachScreenshot });
    };

    cancel.addEventListener("click", dismiss);
    save.addEventListener("click", () => void submit());
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit();
      }
    });

    actions.append(hint);
    if (opts?.onDelete) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "cc-btn cc-btn--ghost";
      del.textContent = "Delete";
      del.addEventListener("click", () => {
        this.closeComposer();
        opts.onDelete?.();
      });
      actions.append(del);
    }
    actions.append(cancel, save);
    panel.append(head, textarea, toggleRow, actions);
    this.composerHighlight = highlight;
    this.composer = panel;
    this.shadow.append(highlight, panel);
    this.reposition();
    this.startTicker();
    textarea.focus();
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
      const classes = ["cc-pin-wrap", `cc-pin-wrap--${model.status}`];
      if (model.status === "resolved") classes.push("cc-pin-wrap--hidden");
      wrap.className = classes.join(" ");

      const marker = document.createElement("div");
      marker.className = "cc-pin";
      const glyphEl = document.createElement("span");
      const g = glyph(model.kind);
      if (g) glyphEl.append(g);
      marker.append(glyphEl);

      const card = document.createElement("div");
      card.className = "cc-pin-card";

      const preview = document.createElement("div");
      preview.className = "cc-pin-card-preview";
      preview.textContent = model.text;
      card.append(preview);

      if (model.removable) {
        marker.style.cursor = "pointer";
        marker.addEventListener("click", (event) => {
          event.stopPropagation();
          const anchor = resolveXPath(model.operator);
          if (!anchor) return;
          this.showComposer(
            anchor,
            (text, options) => onEdit(model.key, text, options),
            undefined,
            {
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
      pin.el.classList.remove("cc-pin-wrap--focus");
    }
    if (!key) return;
    const target = this.pins.find((p) => p.model.key === key);
    if (target) target.el.classList.add("cc-pin-wrap--focus");
  }

  private closeComposer(): void {
    this.composer?.remove();
    this.composerHighlight?.remove();
    this.composer = null;
    this.composerHighlight = null;
    this.composerAnchor = null;
  }

  // Anchors (pins, the selection box, the composer) ride DOM elements that can
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
    return this.pins.length > 0 || this.selectionEl !== null || this.composerAnchor !== null;
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

    if (this.composerAnchor && this.composerHighlight && this.composer) {
      const rect = this.composerAnchor.getBoundingClientRect();
      place(this.composerHighlight, this.composerAnchor);
      const panelH = this.composer.offsetHeight || 220;
      const clampedLeft = Math.min(
        Math.max(OVERLAY_MARGIN, rect.left),
        window.innerWidth - COMPOSER_WIDTH - OVERLAY_MARGIN,
      );
      const fitsBelow = rect.bottom + panelH + OVERLAY_MARGIN <= window.innerHeight;
      const topRaw = fitsBelow
        ? rect.bottom + OVERLAY_MARGIN
        : Math.max(OVERLAY_MARGIN, rect.top - panelH - OVERLAY_MARGIN);
      this.composer.style.left = `${clampedLeft}px`;
      this.composer.style.top = `${topRaw}px`;
    }
  }
}

function menuButton(glyphEl: SVGSVGElement, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cc-menu-btn";
  const g = document.createElement("span");
  g.className = "cc-menu-glyph";
  g.append(glyphEl);
  const l = document.createElement("span");
  l.textContent = label;
  btn.append(g, l);
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

function place(box: HTMLElement, target: Element): void {
  const rect = target.getBoundingClientRect();
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
}

function glyph(kind: PinModel["kind"]): SVGSVGElement | null {
  if (kind === "style") return icon(ICON_COLOR, "cc-pin-glyph");
  if (kind === "text") return icon(ICON_TEXT, "cc-pin-glyph");
  return null;
}
