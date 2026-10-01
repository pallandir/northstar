import type { DeferralNotice, PinModel } from "../messages.js";
import { ICON_CLOSE, icon } from "./icons.js";
import type { Surface } from "./surface.js";
import type { Mode } from "./toolbar.js";

export interface EditOptions {
  planFirst?: boolean;
  attachScreenshot?: boolean;
}

export interface DrawerHandlers {
  onEdit: (cid: string, text: string, opts?: EditOptions) => void;
  onRemove: (key: string) => void;
  onClose: () => void;
  onRevert: (key: string) => void;
  onHoverComment: (key: string | null) => void;
  onDismissNotice: (commentId: string) => void;
}

export interface DrawerContext {
  mode: Mode;
  connected: boolean;
}

const COMMENT_MAX_LENGTH = 4000;

const DEFAULT_CTX: DrawerContext = { mode: "remote", connected: false };

export class Drawer {
  private readonly root: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly noticesEl: HTMLElement;
  private readonly handlers: DrawerHandlers;
  private open = false;
  private pins: PinModel[] = [];
  private notices: DeferralNotice[] = [];
  private ctx: DrawerContext = DEFAULT_CTX;
  private editing: string | null = null;
  private editField: HTMLTextAreaElement | null = null;
  private editShot: HTMLInputElement | null = null;
  private draft: { text: string; screenshot: boolean } | null = null;
  private activeTab: "comments" | "history" = "comments";

  constructor(surface: Surface, handlers: DrawerHandlers) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.className = "ns-drawer";

    const card = document.createElement("div");
    card.className = "ns-drawer-card";

    const head = document.createElement("div");
    head.className = "ns-drawer-head";
    this.tabsEl = document.createElement("div");
    this.tabsEl.className = "ns-drawer-tabs";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ns-icon-btn ns-drawer-close";
    close.title = "Close the comments panel";
    close.setAttribute("aria-label", "Close the comments panel");
    close.append(icon(ICON_CLOSE, "ns-drawer-close-icon"));
    close.addEventListener("click", () => handlers.onClose());
    head.append(this.tabsEl, close);

    this.noticesEl = document.createElement("div");

    this.listEl = document.createElement("div");
    this.listEl.className = "ns-drawer-list";

    card.append(head, this.noticesEl, this.listEl);
    this.root.toggleAttribute("inert", true);
    this.root.append(card);
    surface.append(this.root);
  }

  setOpen(
    open: boolean,
    pins: PinModel[],
    ctx: DrawerContext,
    notices: DeferralNotice[] = this.notices,
  ): void {
    this.open = open;
    this.root.classList.toggle("ns-drawer--open", open);
    this.root.toggleAttribute("inert", !open);
    this.stopEditing();
    this.ctx = ctx;
    this.render(pins, ctx, notices);
  }

  render(
    pins: PinModel[],
    ctx: DrawerContext = this.ctx,
    notices: DeferralNotice[] = this.notices,
  ): void {
    this.pins = pins;
    this.ctx = ctx;
    this.notices = notices;
    if (this.editing && !pins.some((p) => p.key === this.editing && p.status !== "resolved")) {
      this.stopEditing();
    }
    if (!this.open) return;
    this.renderTabs(pins);
    this.renderNotices(notices);
    this.renderList(pins);
  }

  destroy(): void {
    this.root.remove();
  }

  private renderNotices(notices: DeferralNotice[]): void {
    this.noticesEl.replaceChildren();
    if (notices.length === 0 || this.activeTab !== "comments") return;

    const wrap = document.createElement("div");
    wrap.className = "ns-notices";
    const title = document.createElement("div");
    title.className = "ns-notices-title";
    title.textContent =
      notices.length === 1 ? "1 comment needs a plan" : `${notices.length} comments need a plan`;
    wrap.append(title);

    for (const notice of notices) {
      const row = document.createElement("div");
      row.className = "ns-notice-row";

      const body = document.createElement("div");
      body.className = "ns-notice-body";
      const route = document.createElement("code");
      route.className = "ns-notice-route";
      route.textContent = notice.page;
      const summary = document.createElement("div");
      summary.className = "ns-notice-summary";
      summary.textContent = notice.summary;
      const hint = document.createElement("div");
      hint.className = "ns-notice-hint";
      hint.textContent = "Understood, needs a plan. Discuss in chat.";
      body.append(route, summary, hint);

      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "ns-btn ns-btn--ghost ns-notice-dismiss";
      dismiss.textContent = "Dismiss";
      dismiss.addEventListener("click", () => this.handlers.onDismissNotice(notice.commentId));

      row.append(body, dismiss);
      wrap.append(row);
    }

    this.noticesEl.append(wrap);
  }

  private renderTabs(pins: PinModel[]): void {
    const active = pins.filter((p) => p.status !== "resolved");
    const history = pins.filter((p) => p.status === "resolved");

    this.tabsEl.replaceChildren();
    this.tabsEl.setAttribute("role", "tablist");
    const commentsTab = document.createElement("button");
    commentsTab.type = "button";
    commentsTab.setAttribute("role", "tab");
    commentsTab.setAttribute("aria-selected", String(this.activeTab === "comments"));
    commentsTab.className = `ns-drawer-tab${this.activeTab === "comments" ? " ns-drawer-tab--active" : ""}`;
    commentsTab.textContent = `Comments (${active.length})`;
    commentsTab.addEventListener("click", () => {
      this.activeTab = "comments";
      this.renderTabs(this.pins);
      this.renderNotices(this.notices);
      this.renderList(this.pins);
    });
    const historyTab = document.createElement("button");
    historyTab.type = "button";
    historyTab.setAttribute("role", "tab");
    historyTab.setAttribute("aria-selected", String(this.activeTab === "history"));
    historyTab.className = `ns-drawer-tab${this.activeTab === "history" ? " ns-drawer-tab--active" : ""}`;
    historyTab.textContent = `History (${history.length})`;
    historyTab.addEventListener("click", () => {
      this.activeTab = "history";
      this.renderTabs(this.pins);
      this.renderNotices(this.notices);
      this.renderList(this.pins);
    });
    this.tabsEl.append(commentsTab, historyTab);
  }

  private stopEditing(): void {
    this.editing = null;
    this.editField = null;
    this.editShot = null;
    this.draft = null;
  }

  private renderList(pins: PinModel[]): void {
    const active = pins.filter((p) => p.status !== "resolved");
    const history = pins.filter((p) => p.status === "resolved");

    const field = this.editField;
    if (field?.isConnected) {
      this.draft = { text: field.value, screenshot: this.editShot?.checked ?? false };
    }
    const root = field?.getRootNode() as Document | ShadowRoot | undefined;
    const refocus = Boolean(field && root?.activeElement === field);
    const selStart = field?.selectionStart ?? null;
    const selEnd = field?.selectionEnd ?? null;

    this.listEl.replaceChildren();
    this.renderRows(active, history);

    const next = this.editField;
    if (refocus && next?.isConnected) {
      next.focus({ preventScroll: true });
      if (selStart !== null && selEnd !== null) next.setSelectionRange(selStart, selEnd);
    }
  }

  private renderRows(active: PinModel[], history: PinModel[]): void {
    const list = this.activeTab === "comments" ? active : history;

    if (list.length === 0) {
      this.editField = null;
      this.editShot = null;
      const empty = document.createElement("div");
      empty.className = "ns-drawer-empty";
      empty.textContent =
        this.activeTab === "comments"
          ? "No comments on this page yet."
          : "No implemented comments yet.";
      this.listEl.append(empty);
      return;
    }

    for (const pin of list) {
      this.listEl.append(this.item(pin));
    }
  }

  private item(pin: PinModel): HTMLElement {
    const row = document.createElement("div");
    row.className = "ns-drawer-item";

    row.addEventListener("mouseenter", () => this.handlers.onHoverComment(pin.key));
    row.addEventListener("mouseleave", () => this.handlers.onHoverComment(null));

    const meta = document.createElement("div");
    meta.className = "ns-drawer-meta";
    const dot = document.createElement("span");
    dot.className = `ns-dot ns-dot--${pin.status}`;
    const tag = document.createElement("span");
    tag.className = "ns-drawer-tag";
    tag.textContent = pin.removable ? kindLabel(pin) : `${kindLabel(pin)} · synced`;
    const target = document.createElement("span");
    target.className = "ns-drawer-target";
    target.textContent = pin.target;
    target.title = `${pin.target} · ${pin.route}`;
    meta.append(dot, tag, target);
    row.append(meta);

    if (pin.status === "resolved") {
      const body = document.createElement("div");
      body.className = "ns-drawer-text";
      body.textContent = pin.text;
      row.append(body);

      const actions = document.createElement("div");
      actions.className = "ns-drawer-actions";
      const revert = document.createElement("button");
      revert.type = "button";
      revert.className = "ns-btn ns-btn--secondary";
      revert.textContent = "Revert";
      revert.title = "Undo the previewed change on the page";
      revert.addEventListener("click", () => this.handlers.onRevert(pin.key));
      actions.append(revert);
      row.append(actions);
      return row;
    }

    if (this.editing === pin.key && pin.removable) {
      const textarea = document.createElement("textarea");
      textarea.className = "ns-field ns-drawer-edit";
      textarea.maxLength = COMMENT_MAX_LENGTH;
      textarea.value = this.draft?.text ?? pin.text;
      this.editField = textarea;

      const screenshotRow = document.createElement("label");
      screenshotRow.className = "ns-drawer-edit-screenshot";
      const screenshotCheckbox = document.createElement("input");
      screenshotCheckbox.type = "checkbox";
      screenshotCheckbox.checked = this.draft?.screenshot ?? pin.hasScreenshot;
      this.editShot = screenshotCheckbox;
      screenshotRow.append(screenshotCheckbox, document.createTextNode(" Attach screenshot"));

      const actions = document.createElement("div");
      actions.className = "ns-drawer-actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ns-btn ns-btn--primary";
      save.textContent = "Save";
      save.addEventListener("click", () => {
        const value = textarea.value.trim();
        this.stopEditing();
        if (value) {
          const attachScreenshot =
            screenshotCheckbox.checked === pin.hasScreenshot
              ? undefined
              : screenshotCheckbox.checked;
          this.handlers.onEdit(pin.key, value, { planFirst: pin.planFirst, attachScreenshot });
        } else {
          this.render(this.pins);
        }
      });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ns-btn";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        this.stopEditing();
        this.render(this.pins);
      });
      actions.append(cancel, save);
      row.append(textarea, screenshotRow, actions);
      return row;
    }

    const body = document.createElement("div");
    body.className = "ns-drawer-text";
    body.textContent = pin.text;
    row.append(body);

    if (pin.rejection) {
      row.append(problemNote(pin.rejection.error, pin.rejection.fix));
    } else if (pin.missing) {
      row.append(
        problemNote(
          "This element was not found on this page.",
          "Open the page where you left it, or delete the comment.",
        ),
      );
    }

    if (pin.removable) {
      const actions = document.createElement("div");
      actions.className = "ns-drawer-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "ns-btn ns-btn--secondary";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        this.editing = pin.key;
        this.draft = null;
        this.render(this.pins);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "ns-btn ns-btn--ghost ns-drawer-del";
      del.textContent = "Delete";
      del.title = "Delete this comment";
      del.addEventListener("click", () => this.handlers.onRemove(pin.key));
      actions.append(edit, del);
      row.append(actions);
    }
    return row;
  }
}

function problemNote(error: string, fix: string): HTMLElement {
  const note = document.createElement("div");
  note.className = "ns-drawer-problem";
  note.setAttribute("role", "alert");
  const title = document.createElement("div");
  title.className = "ns-drawer-problem-title";
  title.textContent = error;
  const hint = document.createElement("div");
  hint.className = "ns-drawer-problem-hint";
  hint.textContent = fix;
  note.append(title, hint);
  return note;
}

function kindLabel(pin: PinModel): string {
  if (pin.kind === "style") return "Style";
  if (pin.kind === "text") return "Text";
  return "Comment";
}
