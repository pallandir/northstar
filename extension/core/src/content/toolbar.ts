import { browser } from "../lib/browser.js";
import type { DeferralNotice, QueueStatus, SendOutcome } from "../messages.js";
import {
  ICON_COMMENT,
  ICON_GRIP,
  ICON_HANDOFF,
  ICON_SEND,
  ICON_TARGET,
  ICON_TRASH,
  icon,
} from "./icons.js";
import type { Surface } from "./surface.js";

export type ToolId = "select" | "comment" | "color" | "text";
export type Mode = "local" | "remote";

const POS_KEY = "cc-toolbar-pos";

export interface ToolbarHandlers {
  onComments: () => void;
  onSend: () => void;
  onHandoff: () => void;
  onReset: () => void;
  onDismissNotice: (commentId: string) => void;
  onTogglePick: () => void;
}

export interface ToolbarState {
  mode: Mode;
  count: number;
  status: QueueStatus | null;
  drawerOpen: boolean;
  lastSend: SendOutcome | null;
  picking: boolean;
}

export class Toolbar {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly commentsBtn: HTMLButtonElement;
  private readonly commentsLabel: Text;
  private readonly sendBtn: HTMLButtonElement;
  private readonly handoffBtn: HTMLButtonElement;
  private readonly targetBtn: HTMLButtonElement;
  private readonly handlers: ToolbarHandlers;
  private readonly sendLabel: Text;
  private panelKey = "";
  private sentTimer = 0;

  constructor(surface: Surface, handlers: ToolbarHandlers) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.className = "cc-toolbar";

    this.panel = document.createElement("div");
    this.panel.className = "cc-tb-panel";
    this.panel.hidden = true;

    const grip = document.createElement("div");
    grip.className = "cc-grip cc-has-tip";
    grip.append(icon(ICON_GRIP, "cc-action-glyph"));
    grip.dataset.tip = "Drag to move";
    this.makeDraggable(grip);

    this.targetBtn = document.createElement("button");
    this.targetBtn.type = "button";
    this.targetBtn.className = "cc-action cc-action--icon cc-action--active cc-has-tip";
    this.targetBtn.dataset.tip = "Pause element picking";
    this.targetBtn.append(icon(ICON_TARGET, "cc-action-glyph"));
    this.targetBtn.addEventListener("click", () => handlers.onTogglePick());

    this.commentsLabel = document.createTextNode("Comments");
    this.commentsBtn = document.createElement("button");
    this.commentsBtn.type = "button";
    this.commentsBtn.className = "cc-action cc-has-tip";
    this.commentsBtn.dataset.tip = "Open the comments panel";
    this.commentsBtn.append(icon(ICON_COMMENT, "cc-action-glyph"), this.commentsLabel);
    this.commentsBtn.addEventListener("click", () => handlers.onComments());

    this.sendLabel = document.createTextNode("Send to AI");
    this.sendBtn = document.createElement("button");
    this.sendBtn.type = "button";
    this.sendBtn.className = "cc-action cc-action--primary cc-has-tip";
    this.sendBtn.dataset.tip = "Send all comments to your AI assistant";
    this.sendBtn.append(icon(ICON_SEND, "cc-action-glyph"), this.sendLabel);
    this.sendBtn.addEventListener("click", () => handlers.onSend());

    this.handoffBtn = action(ICON_HANDOFF, "Handoff", "Download a Markdown handoff", () =>
      handlers.onHandoff(),
    );

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "cc-action cc-action--icon cc-action--danger cc-has-tip";
    resetBtn.dataset.tip = "Delete all comments on this page";
    resetBtn.append(icon(ICON_TRASH, "cc-action-glyph"));
    resetBtn.addEventListener("click", () => handlers.onReset());

    this.root.append(
      this.panel,
      grip,
      this.targetBtn,
      sep(),
      this.commentsBtn,
      sep(),
      this.sendBtn,
      this.handoffBtn,
      resetBtn,
    );
    surface.append(this.root);
    void this.restorePosition();
  }

  destroy(): void {
    window.clearTimeout(this.sentTimer);
    this.root.remove();
  }

  render(state: ToolbarState): void {
    this.targetBtn.classList.toggle("cc-action--active", state.picking);
    this.targetBtn.dataset.tip = state.picking ? "Pause element picking" : "Resume element picking";

    this.commentsLabel.textContent = `Comments (${state.count})`;

    if (state.mode === "remote") {
      this.sendBtn.hidden = true;
      this.handoffBtn.classList.add("cc-action--primary");
      this.setPanel("remote", () => remotePanel());
      return;
    }

    this.sendBtn.hidden = false;

    const status = state.status;
    const reachable = Boolean(status?.serverReachable);
    this.sendBtn.disabled = !reachable || !status || status.queued === 0;
    this.handoffBtn.classList.toggle("cc-action--primary", !reachable);

    const notices = status?.notices ?? [];
    const send = state.lastSend;
    const terminal = status?.terminal;

    if (notices.length > 0) {
      this.setPanel(`notices:${notices.map((n) => n.commentId).join(",")}`, () =>
        this.noticePanel(notices),
      );
    } else if (send && !send.typed && send.reason) {
      this.setPanel(`send:${send.reason}`, () =>
        hintPanel("Comments saved, not announced", send.reason ?? ""),
      );
    } else if (!reachable) {
      this.setPanel("offline", () =>
        hintPanel(
          "No Northstar server on this machine",
          "Start your AI agent in the project you are commenting on. Northstar runs alongside it.",
        ),
      );
    } else if (terminal && !terminal.available) {
      this.setPanel(`terminal:${terminal.reason ?? ""}`, () =>
        hintPanel("Comments will not reach your agent", terminal.reason ?? ""),
      );
    } else {
      this.clearPanel();
    }
  }

  flashSent(send: SendOutcome): void {
    if (!send.typed) return;
    window.clearTimeout(this.sentTimer);
    this.sendLabel.textContent = send.sent === 1 ? "Sent 1" : `Sent ${send.sent}`;
    this.sentTimer = window.setTimeout(() => {
      this.sendLabel.textContent = "Send to AI";
    }, 1600);
  }

  private setPanel(key: string, build: () => HTMLElement): void {
    if (this.panelKey === key) return;
    this.panelKey = key;
    this.panel.replaceChildren(build());
    this.panel.hidden = false;
  }

  private clearPanel(): void {
    if (this.panelKey === "") return;
    this.panelKey = "";
    this.panel.replaceChildren();
    this.panel.hidden = true;
  }

  private noticePanel(notices: DeferralNotice[]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cc-notices";

    const title = document.createElement("div");
    title.className = "cc-notices-title";
    title.textContent =
      notices.length === 1 ? "1 comment needs a plan" : `${notices.length} comments need a plan`;
    wrap.append(title);

    for (const notice of notices) {
      const row = document.createElement("div");
      row.className = "cc-notice-row";

      const body = document.createElement("div");
      body.className = "cc-notice-body";

      const route = document.createElement("code");
      route.className = "cc-notice-route";
      route.textContent = notice.page;

      const summary = document.createElement("div");
      summary.className = "cc-notice-summary";
      summary.textContent = notice.summary;

      const hint = document.createElement("div");
      hint.className = "cc-notice-hint";
      hint.textContent = "Understood, needs a plan. Discuss in chat.";

      body.append(route, summary, hint);

      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "cc-action cc-action--ghost cc-notice-dismiss";
      dismiss.textContent = "Dismiss";
      dismiss.addEventListener("click", () => this.handlers.onDismissNotice(notice.commentId));

      row.append(body, dismiss);
      wrap.append(row);
    }

    return wrap;
  }

  private makeDraggable(handle: HTMLElement): void {
    handle.classList.add("cc-drag");
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    const onMove = (event: PointerEvent) => {
      this.root.style.left = `${Math.max(0, originLeft + (event.clientX - startX))}px`;
      this.root.style.top = `${Math.max(0, originTop + (event.clientY - startY))}px`;
      this.root.style.transform = "none";
      this.root.style.bottom = "auto";
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      void browser.storage.local.set({
        [POS_KEY]: { left: this.root.style.left, top: this.root.style.top },
      });
    };
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const rect = this.root.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      originLeft = rect.left;
      originTop = rect.top;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  private async restorePosition(): Promise<void> {
    const stored = await browser.storage.local.get(POS_KEY);
    const pos = stored[POS_KEY] as { left: string; top: string } | undefined;
    if (pos?.left && pos.top) {
      this.root.style.left = pos.left;
      this.root.style.top = pos.top;
      this.root.style.transform = "none";
      this.root.style.bottom = "auto";
    }
  }
}

function action(
  iconNode: string,
  label: string,
  tip: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cc-action cc-has-tip";
  btn.dataset.tip = tip;
  btn.append(icon(iconNode, "cc-action-glyph"), label);
  btn.addEventListener("click", onClick);
  return btn;
}

function sep(): HTMLElement {
  const el = document.createElement("span");
  el.className = "cc-sep";
  return el;
}

function hintPanel(title: string, body: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cc-setup";
  const heading = document.createElement("div");
  heading.className = "cc-setup-title";
  heading.textContent = title;
  const sub = document.createElement("div");
  sub.className = "cc-setup-hint";
  sub.textContent = body;
  wrap.append(heading, sub);
  return wrap;
}

function remotePanel(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cc-setup";
  const title = document.createElement("div");
  title.className = "cc-setup-title";
  title.textContent = "Remote page";
  const sub = document.createElement("div");
  sub.className = "cc-setup-hint";
  sub.textContent = "Comment freely, then click Handoff to export a file for your developers.";
  wrap.append(title, sub);
  return wrap;
}
