import { browser } from "../lib/browser.js";
import type { ProblemNote, QueueStatus, SendOutcome } from "../messages.js";
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
const HANDOFF_TIP = "Download this page's unsent comments as a Markdown file";

function setTip(el: HTMLElement, tip: string): void {
  el.dataset.tip = tip;
  if (el.classList.contains("ns-action--icon") || el.classList.contains("ns-grip")) {
    el.setAttribute("aria-label", tip);
  }
}

export interface ToolbarHandlers {
  onComments: () => void;
  onSend: (sessionId?: string) => void;
  onHandoff: () => void;
  onReset: () => void;
  onTogglePick: () => void;
  onDeactivate: () => void;
  onChooseProject: (root: string) => void;
  onQuickRun: (agent: string) => void;
  onCopyLine: () => void;
}

export interface ToolbarState {
  mode: Mode;
  count: number;
  noticeCount: number;
  status: QueueStatus | null;
  drawerOpen: boolean;
  lastSend: SendOutcome | null;
  picking: boolean;
  problem: ProblemNote | null;
}

interface StripAction {
  label: string;
  run: () => void;
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
  private savedTimer = 0;
  private saved = false;
  private lastState: ToolbarState | null = null;
  private sending = false;
  private reachable = false;
  private blocked: string | null = null;
  private pending = 0;
  private readonly handlers: ToolbarHandlers;
  private readonly onResize = () => this.clampIntoViewport();

  constructor(surface: Surface, handlers: ToolbarHandlers) {
    this.handlers = handlers;
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
    window.clearTimeout(this.savedTimer);
    window.removeEventListener("resize", this.onResize);
    this.root.remove();
  }

  setSending(sending: boolean): void {
    this.sending = sending;
    this.syncSendButton();
  }

  private syncSendButton(): void {
    this.sendBtn.disabled =
      this.sending || !this.reachable || this.blocked !== null || this.pending === 0;
    setTip(this.sendBtn, this.sendTip());
  }

  private sendTip(): string {
    if (this.sending) return "Sending to your AI assistant";
    if (!this.reachable)
      return "Not connected, open a new terminal tab and start your AI assistant in this project";
    if (this.blocked !== null) return this.blocked;
    if (this.pending === 0) return "Nothing to send yet, add a comment first";
    return this.pending === 1
      ? "Send 1 comment to your AI assistant"
      : `Send ${this.pending} comments to your AI assistant`;
  }

  flashSaved(): void {
    window.clearTimeout(this.savedTimer);
    this.saved = true;
    this.savedTimer = window.setTimeout(() => {
      this.saved = false;
      if (this.lastState) this.render(this.lastState);
    }, 1600);
    if (this.lastState) this.render(this.lastState);
  }

  render(state: ToolbarState): void {
    this.lastState = state;
    this.targetBtn.classList.toggle("ns-action--active", state.picking);
    setTip(this.targetBtn, state.picking ? PICK_ON_TIP : PICK_OFF_TIP);
    setTip(this.commentsBtn, state.drawerOpen ? COMMENTS_CLOSE_TIP : COMMENTS_OPEN_TIP);

    this.commentsLabel.textContent = this.saved
      ? "Saved"
      : state.noticeCount > 0
        ? `Comments (${state.count}) · ${state.noticeCount} ${state.noticeCount === 1 ? "needs" : "need"} a plan`
        : `Comments (${state.count})`;

    if (state.mode === "remote") {
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
    this.pending = (status?.queued ?? 0) + (status?.open ?? 0);
    const readiness = status?.readiness;
    this.blocked = !readiness
      ? null
      : readiness.needsPick
        ? "Pick the session to send to below"
        : !readiness.ready
          ? `Send to AI is off, ${readiness.reason ?? ""} ${readiness.fix ?? ""}`.trim()
          : null;
    this.syncSendButton();
    this.handoffBtn.classList.toggle("ns-action--primary", !reachable);

    const send = state.lastSend;
    const connection = status?.connection ?? "offline";
    const handoff = status?.handoff;

    if (state.problem) {
      this.showFailure(`problem:${state.problem.error}`, state.problem.error, state.problem.fix);
    } else if (connection === "choose") {
      this.showFailure(
        `choose:${status?.projects.map((project) => project.root).join(",")}`,
        "More than one project is running",
        "Pick the project you are commenting on.",
        (status?.projects ?? []).map((project) => ({
          label: project.project,
          run: () => this.handlers.onChooseProject(project.root),
        })),
      );
    } else if (connection === "mismatch" && status?.problem) {
      this.showFailure(
        `mismatch:${status.problem.error}`,
        status.problem.error,
        status.problem.fix,
      );
    } else if (connection === "offline") {
      this.showFailure(
        `offline:${status?.problem?.error ?? ""}`,
        status?.problem?.error ?? "Northstar's browser helper is not reachable",
        status?.problem?.fix ??
          "Run npm install -g @pallandir/northstar, then northstar install, then reload this page.",
      );
    } else if (connection === "noproject") {
      this.showFailure(
        "noproject",
        "No project is running",
        "Open a new terminal tab and start your AI assistant in the project you are commenting on.",
      );
    } else if (send && send.rejected > 0) {
      this.showFailure(
        `rejected:${send.rejected}:${send.reason ?? ""}`,
        send.rejected === 1 ? "1 comment was not sent" : `${send.rejected} comments were not sent`,
        send.reason ?? "Open Comments to see why and fix them.",
      );
    } else if (handoff && !handoff.delivered && handoff.reason) {
      this.showFailure(
        `handoff:${handoff.at}`,
        handoff.blocked
          ? "Comments saved, the agent needs you first"
          : "Comments saved, the agent did not start",
        `${handoff.reason} ${handoff.fix ?? ""}`.trim(),
      );
    } else if (readiness?.needsPick && this.pending > 0) {
      this.showFailure(
        `pick:${readiness.sessions.map((session) => session.id).join(",")}`,
        "More than one agent session is running here",
        "Pick the session that should get the comments.",
        readiness.sessions.map((session) => ({
          label: `${session.name}, ${session.cwd.split(/[\\/]/).filter(Boolean).pop() ?? session.cwd}`,
          run: () => this.handlers.onSend(session.id),
        })),
      );
    } else if (readiness && !readiness.ready) {
      const quick: StripAction[] =
        this.pending > 0
          ? [
              { label: "Copy the line", run: () => this.handlers.onCopyLine() },
              ...(status?.agents ?? []).map((agent) => ({
                label: `Quick run with ${agent.name}`,
                run: () => this.handlers.onQuickRun(agent.id),
              })),
            ]
          : [];
      this.showFailure(
        `no-session:${(status?.agents ?? []).map((agent) => agent.id).join(",")}:${this.pending > 0}`,
        "No agent session in this project",
        `${readiness.reason ?? ""} ${readiness.fix ?? ""}`.trim(),
        quick,
      );
    } else {
      this.clearPanel();
    }
  }

  private showFailure(key: string, title: string, body: string, actions: StripAction[] = []): void {
    if (key === this.dismissedKey) return;
    this.setPanel(key, () => hintStrip(title, body, () => this.dismiss(key), actions));
  }

  private dismiss(key: string): void {
    this.dismissedKey = key;
    this.clearPanel();
  }

  flashSent(send: SendOutcome): void {
    if (!send.woke?.delivered) return;
    window.clearTimeout(this.sentTimer);
    this.sendLabel.textContent = `Sent to ${send.woke.session?.name ?? "the agent"}`;
    this.sentTimer = window.setTimeout(() => {
      this.sendLabel.textContent = "Send to AI";
    }, 1600);
  }

  flashCopied(): void {
    window.clearTimeout(this.sentTimer);
    this.sendLabel.textContent = "Line copied";
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
      handle.setPointerCapture(event.pointerId);
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

function hintStrip(
  title: string,
  body: string,
  onDismiss: () => void,
  actions: StripAction[],
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ns-setup";
  wrap.setAttribute("role", "alert");

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
  if (actions.length > 0) {
    const bar = document.createElement("div");
    bar.className = "ns-setup-actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ns-btn ns-btn--primary";
      btn.textContent = action.label;
      btn.addEventListener("click", action.run);
      bar.append(btn);
    }
    wrap.append(bar);
  }
  return wrap;
}
