import { browser } from "./lib/browser.js";
import { createLock } from "./lib/lock.js";
import { LOOPBACK_MATCHES, isLocalUrl, originOf } from "./lib/origins.js";
import { status as fetchStatus } from "./lib/transport.js";
import type { Message, QueueStatus } from "./messages.js";
import { installProbe } from "./probe/probe-script.js";

const STATE_KEY = "cc-active";
const BADGE_COLOR = "#1e66f5";

type TabMode = "on" | "paused" | "failed";

interface TabState {
  origin: string | null;
  mode: TabMode;
  message?: string;
}

const locked = createLock();

export function logFailure(label: string, task: Promise<unknown>): void {
  task.catch((err: unknown) => console.error(`[northstar] ${label}`, err));
}

async function readStates(): Promise<Record<string, TabState>> {
  const stored = await browser.storage.session.get(STATE_KEY);
  const map: unknown = stored[STATE_KEY];
  return typeof map === "object" && map !== null ? (map as Record<string, TabState>) : {};
}

function updateState(tabId: number, next: TabState | null): Promise<void> {
  return locked(async () => {
    const map = await readStates();
    if (next) map[tabId] = next;
    else delete map[tabId];
    await browser.storage.session.set({ [STATE_KEY]: map });
  });
}

export async function getTabState(tabId: number): Promise<TabState | null> {
  return (await readStates())[tabId] ?? null;
}

export async function isOn(tabId: number): Promise<boolean> {
  return (await getTabState(tabId))?.mode === "on";
}

export function initBadge(): Promise<void> {
  return browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
}

export function refreshActiveTitles(): Promise<void> {
  return browser.tabs.query({ active: true }).then(async (tabs) => {
    for (const tab of tabs) if (tab.id !== undefined) await refreshTitle(tab.id);
  });
}

type Grant = { granted: true } | { granted: false; message: string };

async function requestLoopbackAccess(): Promise<Grant> {
  try {
    const granted = await browser.permissions.request({ origins: LOOPBACK_MATCHES });
    return granted
      ? { granted }
      : {
          granted,
          message:
            "Northstar needs access to localhost to work on local pages. Click the icon to allow it.",
        };
  } catch (err) {
    return {
      granted: false,
      message: `Northstar could not ask for localhost access: ${(err as Error).message}`,
    };
  }
}

function agentName(agent: string): string {
  if (agent === "claude-code") return "Claude Code session";
  if (agent === "gemini") return "Gemini CLI session";
  return "Codex session";
}

function statusLine(url: string | undefined, status: QueueStatus): string {
  if (url === undefined || !isLocalUrl(url)) {
    return "Comments on this page are exported as a handoff file.";
  }
  switch (status.connection) {
    case "offline":
      return "No project connected. Start your AI agent in the project you are commenting on.";
    case "unpaired":
      return "Not connected. Click Connect in the Northstar toolbar on the page.";
    case "choose":
      return "More than one project is running. Pick one in the Northstar toolbar on the page.";
    case "mismatch":
      return `${status.problem?.error ?? "Versions differ."} ${status.problem?.fix ?? ""}`.trim();
    case "connected":
      if (status.problem) return `${status.problem.error} ${status.problem.fix}`;
      if (!status.agent) return "Connected, waiting for the agent status.";
      return status.agent.ready
        ? `Ready. Send to AI wakes your ${agentName(status.agent.agent)}.`
        : `Connected, but Send to AI is off. ${status.agent.reason ?? ""} ${status.agent.fix ?? ""}`.trim();
  }
}

export async function refreshTitle(tabId: number, known?: QueueStatus): Promise<void> {
  const tab = await browser.tabs.get(tabId);
  const state = await getTabState(tabId);
  if (state && state.mode !== "on" && state.message) {
    await browser.action.setTitle({ tabId, title: `Northstar\n${state.message}` });
    return;
  }
  let line: string;
  if (tab.url !== undefined && isLocalUrl(tab.url)) {
    line = statusLine(tab.url, known ?? (await fetchStatus(originOf(tab.url))));
  } else {
    line = "Comments on this page are exported as a handoff file.";
  }
  const head =
    state?.mode === "on"
      ? "Northstar is on, click to toggle comments"
      : "Northstar, click to toggle comments";
  await browser.action.setTitle({ tabId, title: `${head}\n${line}` });
}

async function injectOverlay(tabId: number, contentScript: string): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId }, files: [contentScript] });
  await browser.scripting.executeScript({ target: { tabId }, world: "MAIN", func: installProbe });
}

async function markOn(tabId: number, origin: string | null): Promise<void> {
  await updateState(tabId, { origin, mode: "on" });
  await browser.action.setBadgeText({ tabId, text: "ON" });
}

async function markFailed(
  tabId: number,
  origin: string | null,
  mode: TabMode,
  badge: string,
  message: string,
): Promise<void> {
  await updateState(tabId, { origin, mode, message });
  await browser.action.setBadgeText({ tabId, text: badge });
  await refreshTitle(tabId);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function turnOn(
  tabId: number,
  url: string | undefined,
  contentScript: string,
): Promise<void> {
  const origin = url === undefined ? null : originOf(url);
  try {
    await injectOverlay(tabId, contentScript);
  } catch (err) {
    console.error("[northstar] injection failed", err);
    await markFailed(
      tabId,
      origin,
      "failed",
      "n/a",
      `Northstar cannot run on this page: ${describe(err)}`,
    );
    return;
  }
  await markOn(tabId, origin);
  await browser.tabs.sendMessage(tabId, { type: "set-active", on: true } satisfies Message);
  await refreshTitle(tabId);
}

export async function turnOff(tabId: number): Promise<void> {
  const state = await getTabState(tabId);
  await updateState(tabId, null);
  await browser.action.setBadgeText({ tabId, text: "" });
  if (state?.mode === "on") {
    await browser.tabs.sendMessage(tabId, { type: "set-active", on: false } satisfies Message);
  }
  await refreshTitle(tabId);
}

export function createActivation(contentScript: string) {
  async function onActionClicked(tab: chrome.tabs.Tab): Promise<void> {
    const tabId = tab.id;
    if (tabId === undefined) return;
    const needsLoopback = tab.url !== undefined && isLocalUrl(tab.url);
    const access: Promise<Grant> = needsLoopback
      ? requestLoopbackAccess()
      : Promise.resolve({ granted: true });
    const state = await getTabState(tabId);
    if (state?.mode === "on") {
      await turnOff(tabId);
      return;
    }
    const grant = await access;
    if (!grant.granted) {
      const origin = tab.url === undefined ? null : originOf(tab.url);
      await markFailed(tabId, origin, "failed", "!", grant.message);
      return;
    }
    await turnOn(tabId, tab.url, contentScript);
  }

  async function reinject(tabId: number, state: TabState): Promise<void> {
    const tab = await browser.tabs.get(tabId);
    const origin = tab.url === undefined ? null : originOf(tab.url);
    if (origin !== null && state.origin !== null && origin !== state.origin) {
      await updateState(tabId, null);
      await browser.action.setBadgeText({ tabId, text: "" });
      await refreshTitle(tabId);
      return;
    }
    try {
      await injectOverlay(tabId, contentScript);
    } catch (err) {
      console.error("[northstar] re-injection failed", err);
      if (origin === null) {
        await markFailed(
          tabId,
          state.origin,
          "paused",
          "!",
          "Northstar paused when the page reloaded. Click the icon to restore it.",
        );
      } else {
        await markFailed(
          tabId,
          origin,
          "failed",
          "n/a",
          `Northstar cannot run on this page: ${describe(err)}`,
        );
      }
      return;
    }
    await markOn(tabId, state.origin ?? origin);
    await refreshTitle(tabId);
  }

  async function onTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo): Promise<void> {
    if (changeInfo.url !== undefined) {
      const state = await getTabState(tabId);
      if (state?.origin && originOf(changeInfo.url) !== state.origin) {
        await updateState(tabId, null);
        await browser.action.setBadgeText({ tabId, text: "" });
      }
    }
    if (changeInfo.status !== "complete") return;
    const state = await getTabState(tabId);
    if (!state) {
      await refreshTitle(tabId);
      return;
    }
    if (state.mode === "failed") {
      await updateState(tabId, null);
      await browser.action.setBadgeText({ tabId, text: "" });
      await refreshTitle(tabId);
      return;
    }
    await reinject(tabId, state);
  }

  async function onTabRemoved(tabId: number): Promise<void> {
    await updateState(tabId, null);
  }

  return { onActionClicked, onTabUpdated, onTabRemoved };
}
