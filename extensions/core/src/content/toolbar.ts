import { browser } from "../lib/browser.js";
import type { QueueStatus, SendOutcome } from "../messages.js";
import {
  ICON_CLOSE,
  ICON_COMMENT,
  ICON_GRIP,
  ICON_HANDOFF,
  ICON_POWER,
  ICON_SEND,
  ICON_TARGET,
  ICON_TRASH,
  icon,
} from "./icons.js";
import type { Surface } from "./surface.js";

export type Mode = "local" | "remote";

const POS_KEY = "cc-toolbar-pos";
const TIP_ROOM = 56;
const PICK_ON_TIP = "Picking is on, click to pause and use the page";
const PICK_OFF_TIP = "Picking is paused, click to pick elements to comment on";
const COMMENTS_OPEN_TIP = "Open the comments panel";
const COMMENTS_CLOSE_TIP = "Close the comments panel";
const SEND_READY_TIP = "Send your comments to your AI assistant";
const HANDOFF_TIP = "Download all comments as a Markdown file";

export function setTip(el: HTMLElement, tip: string): void {
  el.dataset.tip = tip;
  if (el.classList.contains("ns-action--icon") || el.classList.contains("ns-grip")) {
    el.setAttribute("aria-label", tip);
  }
}

export interface ToolbarHandlers {
  onComments: () => void;
  onSend: () => void;
  onHandoff: () => void;
  onReset: () => void;
  onTogglePick: () => void;
  onDeactivate: () => void;
}

export interface ToolbarState {
  mode: Mode;
  count: number;
  noticeCount: number;
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
  private readonly deactivateBtn: HTMLButtonElement;
  private readonly sendLabel: Text;
  private panelKey = "";
  private dismissedKey = "";
  private sentTimer = 0;
  private sending = false;
  private reachable = false;
  private hasQueued = false;
  private queued = 0;
  private readonly onResize = () => this.clampIntoViewport();

  constructor(surface: Surface, handlers: ToolbarHandlers) {
    this.root = document.createElement("div");
    this.root.className = "ns-toolbar";

    this.panel = document.createElement("div");
    this.panel.className = "ns-tb-panel";
    this.panel.hidden = true;

    const grip = document.createElement("div");
    grip.className = "ns-grip ns-has-tip ns-has-tip--start";
    grip.append(icon(ICON_GRIP, "ns-action-glyph"));
    setTip(grip, "Drag to move the toolbar");
    this.makeDraggable(grip);

    this.targetBtn = document.createElement("button");
    this.targetBtn.type = "button";
    this.targetBtn.className = "ns-action ns-action--icon ns-action--active ns-has-tip";
    setTip(this.targetBtn, PICK_ON_TIP);
    this.targetBtn.append(icon(ICON_TARGET, "ns-action-glyph"));
    this.targetBtn.addEventListener("click", () => handlers.onTogglePick());

    this.commentsLabel = document.createTextNode("Comments");
    this.commentsBtn = document.createElement("button");
    this.commentsBtn.type = "button";
    this.commentsBtn.className = "ns-action ns-has-tip";
    setTip(this.commentsBtn, COMMENTS_OPEN_TIP);
    this.commentsBtn.append(icon(ICON_COMMENT, "ns-action-glyph"), this.commentsLabel);
    this.commentsBtn.addEventListener("click", () => handlers.onComments());

    this.sendLabel = document.createTextNode("Send to AI");
    this.sendBtn = document.createElement("button");
    this.sendBtn.type = "button";
    this.sendBtn.className = "ns-action ns-action--primary ns-has-tip";
    setTip(this.sendBtn, SEND_READY_TIP);
    this.sendBtn.append(icon(ICON_SEND, "ns-action-glyph"), this.sendLabel);
    this.sendBtn.addEventListener("click", () => handlers.onSend());

    this.handoffBtn = action(ICON_HANDOFF, "Handoff", HANDOFF_TIP, () => handlers.onHandoff());

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "ns-action ns-action--icon ns-action--danger ns-has-tip";
    setTip(resetBtn, "Delete all comments");
    resetBtn.append(icon(ICON_TRASH, "ns-action-glyph"));
    resetBtn.addEventListener("click", () => handlers.onReset());

    this.deactivateBtn = document.createElement("button");
    this.deactivateBtn.type = "button";
    this.deactivateBtn.className = "ns-action ns-action--icon ns-has-tip ns-has-tip--end";
    setTip(this.deactivateBtn, "Deactivate Northstar on this tab, your comments are kept");
    this.deactivateBtn.append(icon(ICON_POWER, "ns-action-glyph"));
    this.deactivateBtn.addEventListener("click", () => handlers.onDeactivate());

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
      sep(),
      this.deactivateBtn,
    );
    surface.append(this.root);
    window.addEventListener("resize", this.onResize);
    void this.restorePosition();
  }

  destroy(): void {
    window.clearTimeout(this.sentTimer);
    window.removeEventListener("resize", this.onResize);
    this.root.remove();
  }

  setSending(sending: boolean): void {
    this.sending = sending;
    this.syncSendButton();
  }

  private syncSendButton(): void {
    this.sendBtn.disabled = this.sending || !this.reachable || !this.hasQueued;
    setTip(this.sendBtn, this.sendTip());
  }

  private sendTip(): string {
    if (this.sending) return "Sending your comments";
    if (!this.reachable) return "Not connected, start your AI agent in this project first";
    if (!this.hasQueued) return "Nothing to send yet, add a comment first";
    return this.queued === 1
      ? "Send 1 comment to your AI assistant"
      : `Send ${this.queued} comments to your AI assistant`;
  }

  render(state: ToolbarState): void {
    this.targetBtn.classList.toggle("ns-action--active", state.picking);
    setTip(this.targetBtn, state.picking ? PICK_ON_TIP : PICK_OFF_TIP);
    setTip(this.commentsBtn, state.drawerOpen ? COMMENTS_CLOSE_TIP : COMMENTS_OPEN_TIP);

    this.commentsLabel.textContent =
      state.noticeCount > 0
        ? `Comments (${state.count}) · ${state.noticeCount} ${state.noticeCount === 1 ? "needs" : "need"} a plan`
        : `Comments (${state.count})`;

    if (state.mode === "remote") {
      // A remote page never reaches the loopback server by design, so there is nothing to
      // explain in a permanent card here: Handoff becomes the one thing to do, and its own
      // tooltip says why.
      this.sendBtn.hidden = true;
      this.handoffBtn.classList.add("ns-action--primary");
      setTip(this.handoffBtn, "Comment freely, then export a handoff file for your developers");
      this.clearPanel();
      return;
    }

    this.sendBtn.hidden = false;
    setTip(this.handoffBtn, HANDOFF_TIP);

    const status = state.status;
    const reachable = Boolean(status?.serverReachable);
    this.reachable = reachable;
    this.hasQueued = Boolean(status && status.queued > 0);
    this.queued = status?.queued ?? 0;
    this.syncSendButton();
    this.handoffBtn.classList.toggle("ns-action--primary", !reachable);

    const send = state.lastSend;
    const terminal = status?.terminal;

    // Only a real failure earns a strip, and only once per distinct problem: dismissing it
    // keeps it dismissed while the same problem persists, rather than a poll cycle bringing
    // it straight back.
    if (send && !send.typed && send.reason) {
      this.showFailure(`send:${send.reason}`, "Comments saved, not announced", send.reason);
    } else if (!reachable) {
      this.showFailure(
        "offline",
        "No Northstar server on this machine",
        "Start your AI agent in the project you are commenting on.",
      );
    } else if (terminal && !terminal.available) {
      this.showFailure(
        `terminal:${terminal.reason ?? ""}`,
        "Comments will not reach your agent",
        terminal.reason ?? "",
      );
    } else {
      this.clearPanel();
    }
  }

  private showFailure(key: string, title: string, body: string): void {
    if (key === this.dismissedKey) return;
    this.setPanel(key, () => hintStrip(title, body, () => this.dismiss(key)));
  }

  private dismiss(key: string): void {
    this.dismissedKey = key;
    this.clearPanel();
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

  private makeDraggable(handle: HTMLElement): void {
    handle.classList.add("ns-drag");
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const rect = this.root.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      originLeft = rect.left;
      originTop = rect.top;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {}
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      this.place(originLeft + (event.clientX - startX), originTop + (event.clientY - startY));
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      void browser.storage.local.set({
        [POS_KEY]: { left: this.root.style.left, top: this.root.style.top },
      });
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  private place(left: number, top: number): void {
    const width = this.root.offsetWidth;
    const height = this.root.offsetHeight;
    const maxLeft = Math.max(0, window.innerWidth - width);
    const maxTop = Math.max(0, window.innerHeight - height);
    this.root.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
    this.root.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
    this.root.style.transform = "none";
    this.root.style.bottom = "auto";
    this.root.toggleAttribute("data-tip-below", top < TIP_ROOM);
  }

  private clampIntoViewport(): void {
    if (this.root.style.transform !== "none") return;
    const rect = this.root.getBoundingClientRect();
    this.place(rect.left, rect.top);
  }

  private async restorePosition(): Promise<void> {
    const stored = await browser.storage.local.get(POS_KEY);
    const pos = stored[POS_KEY] as { left: string; top: string } | undefined;
    const left = Number.parseFloat(pos?.left ?? "");
    const top = Number.parseFloat(pos?.top ?? "");
    if (Number.isFinite(left) && Number.isFinite(top)) this.place(left, top);
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
  btn.className = "ns-action ns-has-tip";
  setTip(btn, tip);
  btn.append(icon(iconNode, "ns-action-glyph"), label);
  btn.addEventListener("click", onClick);
  return btn;
}

function sep(): HTMLElement {
  const el = document.createElement("span");
  el.className = "ns-sep";
  return el;
}

// A one-line strip for a real, ongoing problem, never a permanent card: it carries its own
// dismiss and only reappears if the underlying problem changes to something new.
function hintStrip(title: string, body: string, onDismiss: () => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ns-setup";

  const row = document.createElement("div");
  row.className = "ns-setup-row";
  const heading = document.createElement("div");
  heading.className = "ns-setup-title";
  heading.textContent = title;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "ns-icon-btn ns-drawer-close";
  dismiss.title = "Dismiss this notice";
  dismiss.setAttribute("aria-label", "Dismiss this notice");
  dismiss.append(icon(ICON_CLOSE, "ns-drawer-close-icon"));
  dismiss.addEventListener("click", onDismiss);
  row.append(heading, dismiss);

  const sub = document.createElement("div");
  sub.className = "ns-setup-hint";
  sub.textContent = body;
  wrap.append(row, sub);
  return wrap;
}
