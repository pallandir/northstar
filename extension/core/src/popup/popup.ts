import { browser } from "../lib/browser.js";
import type { Message, QueueStatus } from "../messages.js";

const LOOPBACK_ORIGINS = ["http://localhost/*", "http://127.0.0.1/*", "http://*.localhost/*"];

const REFRESH_MS = 2000;

async function send(
  message: Message,
): Promise<{ ok: boolean; status?: QueueStatus; active?: boolean }> {
  try {
    return await browser.runtime.sendMessage(message);
  } catch {
    return { ok: false };
  }
}

// Firefox treats manifest host permissions as opt-in, so the loopback grant has to be asked for
// from a user gesture or every request to the local server is blocked before it is sent.
async function ensureLoopbackAccess(): Promise<boolean> {
  try {
    if (await browser.permissions.contains({ origins: LOOPBACK_ORIGINS })) return true;
    return await browser.permissions.request({ origins: LOOPBACK_ORIGINS });
  } catch {
    return true;
  }
}

async function init(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    const unavailable = el("p", "rl-unavailable");
    unavailable.textContent = "No active tab found.";
    app.replaceChildren(unavailable);
    return;
  }

  const tabId = tab.id;
  const tabUrl = tab.url ?? "";

  const refresh = async () => {
    const [activeRes, statusRes] = await Promise.all([
      send({ type: "sync-active", tabId }),
      send({ type: "tab-status", tabId, url: tabUrl }),
    ]);
    render(app, {
      isActive: Boolean(activeRes.ok && activeRes.active),
      status: statusRes.ok ? (statusRes.status ?? null) : null,
      tabId,
    });
  };

  await refresh();
  const timer = window.setInterval(() => void refresh(), REFRESH_MS);
  window.addEventListener("beforeunload", () => window.clearInterval(timer));
}

interface State {
  isActive: boolean;
  status: QueueStatus | null;
  tabId: number;
}

function render(app: HTMLElement, state: State): void {
  const { isActive, status, tabId } = state;
  const reachable = Boolean(status?.serverReachable);
  const terminal = status?.terminal;

  const header = el("div", "rl-header");
  const wordmark = el("span", "rl-wordmark");
  wordmark.textContent = "Northstar";
  const badge = el("span", isActive ? "rl-badge rl-badge--live" : "rl-badge");
  badge.textContent = isActive ? "Active" : "";
  header.append(wordmark, badge);

  const body = el("div", "rl-body");

  const activateRow = el("div", "rl-activate");
  const activateText = el("div", "");
  const activateLabel = el("div", "rl-activate-label");
  activateLabel.textContent = isActive ? "Overlay active" : "Activate on this page";
  const activateSub = el("div", "rl-activate-sub");
  activateSub.textContent = isActive
    ? "Click elements to leave comments."
    : "Enables element picking and the comment toolbar.";
  activateText.append(activateLabel, activateSub);

  const activateBtn = el(
    "button",
    `cc-btn ${isActive ? "cc-btn--secondary" : "cc-btn--primary"}`,
  ) as HTMLButtonElement;
  activateBtn.textContent = isActive ? "Deactivate" : "Activate";
  activateBtn.addEventListener("click", async () => {
    activateBtn.disabled = true;
    if (!isActive && !(await ensureLoopbackAccess())) {
      activateBtn.disabled = false;
      return;
    }
    await send({ type: "set-overlay", tabId, on: !isActive });
    window.close();
  });

  activateRow.append(activateText, activateBtn);
  body.append(activateRow, el("div", "rl-divider"), statusRow(reachable, terminal));

  app.replaceChildren(header, body);
}

function statusRow(reachable: boolean, terminal: QueueStatus["terminal"]): HTMLElement {
  const wrap = el("div", "rl-status");
  const label = el("div", "rl-status-label");
  const sub = el("div", "rl-status-sub");

  if (!reachable) {
    label.textContent = "No project connected";
    sub.textContent = "Start your AI agent in the project you are commenting on.";
  } else if (terminal?.available) {
    label.textContent = "Ready";
    sub.textContent = `Send to AI types straight into your ${terminal.driver} session.`;
  } else {
    label.textContent = "Connected, but no terminal";
    sub.textContent = terminal?.reason ?? "Northstar cannot reach the terminal your agent runs in.";
  }

  wrap.append(label, sub);
  return wrap;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

void init();
