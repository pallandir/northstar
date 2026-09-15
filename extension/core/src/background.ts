import contentScript from "./content/content.ts?script";
import { browser } from "./lib/browser.js";
import { captureRegion } from "./lib/capture.js";
import {
  clearAll,
  dismissNotice,
  enqueue,
  fetchServerComments,
  flush,
  isLocalUrl,
  listForUrl,
  remove,
  reopenComment,
  status,
  update,
} from "./lib/transport.js";
import type { Message, PinModel, QueueStatus, Response } from "./messages.js";
import type { SourceLocation } from "./types.js";

const ACTIVE_KEY = "cc-active";

const BADGE_COLOR = "#009efa"; // Chrome badge API requires a hex string, cannot use a CSS var

browser.runtime.onInstalled.addListener(() => {
  void browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
});

// The overlay is injected only here, into the one tab the user just activated, under
// the activeTab grant. The content script guards against re-injection, so toggling
// off then on without a reload is safe. Restricted pages (chrome://, the Web
// Store, view-source) reject injection; we report that and stay off.
async function injectOverlay(tabId: number): Promise<boolean> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [contentScript] });
    return true;
  } catch {
    await browser.action.setBadgeText({ tabId, text: "n/a" });
    return false;
  }
}

async function setOverlay(tabId: number, on: boolean): Promise<void> {
  if (on && !(await injectOverlay(tabId))) return;
  await setActive(tabId, on);
  await browser.action.setBadgeText({ tabId, text: on ? "ON" : "" });
  browser.tabs.sendMessage(tabId, { type: "set-active", on } satisfies Message).catch(() => {});
}

browser.tabs.onRemoved.addListener((tabId) => {
  void setActive(tabId, false);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  void setActive(tabId, false);
  void browser.action.setBadgeText({ tabId, text: "" });
});

browser.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handle(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: (err as Error).message }));
  return true;
});

async function handle(message: Message, sender: chrome.runtime.MessageSender): Promise<Response> {
  if (sender.id !== browser.runtime.id) return { ok: false, error: "forbidden" };
  switch (message.type) {
    case "sync-active": {
      const id = message.tabId ?? sender.tab?.id;
      return { ok: true, active: id !== undefined ? await isActive(id) : false };
    }
    case "set-overlay": {
      await setOverlay(message.tabId, message.on);
      return { ok: true };
    }
    case "tab-status": {
      if (!isLocalUrl(message.url)) return { ok: true, status: offlineStatus() };
      return { ok: true, status: await status() };
    }
    case "capture-region": {
      try {
        const dataUrl = await captureRegion(sender.tab?.windowId, message.rect, message.dpr);
        return { ok: true, dataUrl };
      } catch (err) {
        console.warn("[northstar] capture failed:", (err as Error).message);
        return { ok: true, dataUrl: null };
      }
    }
    case "save-request": {
      const item = await enqueue(message.draft);
      const result = isLocalUrl(sender.tab?.url ?? "") ? await status() : offlineStatus();
      return { ok: true, status: result, cid: item.cid };
    }
    case "page-comments":
      return { ok: true, pins: await pagePins(message.url, sender.tab?.url) };
    case "dismiss-notice": {
      if (!isLocalUrl(sender.tab?.url ?? "")) return { ok: true, status: offlineStatus() };
      await dismissNotice(message.commentId);
      return { ok: true, status: await status() };
    }
    case "get-comments":
      return { ok: true, comments: await listForUrl(message.url) };
    case "remove-comment":
      await remove(message.cid);
      return { ok: true, status: await status() };
    case "clear-all":
      await clearAll();
      return { ok: true, status: await status() };
    case "update-comment":
      await update(message.cid, message.text, {
        planFirst: message.planFirst,
        screenshotDataUrl: message.screenshotDataUrl,
      });
      return { ok: true, status: await status() };
    case "flush": {
      if (!isLocalUrl(sender.tab?.url ?? "")) return { ok: true, status: offlineStatus() };
      const { status: st, send } = await flush();
      return { ok: true, status: st, send };
    }
    case "queue-status": {
      if (!isLocalUrl(sender.tab?.url ?? "")) return { ok: true, status: offlineStatus() };
      return { ok: true, status: await status() };
    }
    case "reopen-comment": {
      if (!isLocalUrl(sender.tab?.url ?? "")) return { ok: true };
      await reopenComment(message.id, message.note);
      return { ok: true };
    }
    default:
      return { ok: false, error: `unhandled message: ${(message as Message).type}` };
  }
}

function offlineStatus(): QueueStatus {
  return {
    queued: 0,
    serverReachable: false,
    port: null,
    root: null,
    notices: [],
    version: null,
    terminal: { available: false },
  };
}

async function isActive(tabId: number): Promise<boolean> {
  const stored = await browser.storage.session.get(ACTIVE_KEY);
  const map = (stored[ACTIVE_KEY] as Record<number, boolean> | undefined) ?? {};
  return Boolean(map[tabId]);
}

async function setActive(tabId: number, on: boolean): Promise<void> {
  const stored = await browser.storage.session.get(ACTIVE_KEY);
  const map = (stored[ACTIVE_KEY] as Record<number, boolean> | undefined) ?? {};
  if (on) map[tabId] = true;
  else delete map[tabId];
  await browser.storage.session.set({ [ACTIVE_KEY]: map });
}

async function pagePins(url: string, tabUrl?: string): Promise<PinModel[]> {
  const [queued, synced] = await Promise.all([
    listForUrl(url),
    isLocalUrl(tabUrl ?? "") ? fetchServerComments(url) : Promise.resolve([]),
  ]);
  return [
    ...queued.map(
      (q): PinModel => ({
        key: q.cid,
        operator: q.operator,
        text: q.comment,
        status: "pending",
        kind: q.operation.type,
        removable: true,
        route: routeOf(q.url),
        target: targetLabel(q.operator, q.source, q.metadata.elementText),
        planFirst: q.planFirst ?? false,
        hasScreenshot: Boolean(q.screenshotDataUrl),
        operation: { property: q.operation.property, from: q.operation.from, to: q.operation.to },
      }),
    ),
    ...synced.map(
      (s): PinModel => ({
        key: s.id,
        operator: s.operator,
        text: s.comment,
        status: s.status === "open" ? "processing" : s.status,
        kind: s.operation.type,
        removable: false,
        route: s.metadata.page,
        target: targetLabel(s.operator, s.source ?? null, s.metadata.elementText),
        planFirst: false,
        hasScreenshot: false,
        operation: { property: s.operation.property, from: s.operation.from, to: s.operation.to },
      }),
    ),
  ];
}

function routeOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function targetLabel(xpath: string, source: SourceLocation | null, elementText: string): string {
  if (source?.path) {
    const base = source.path.split(/[\\/]/).pop() ?? source.path;
    const name = base.replace(/\.[^.]+$/, "");
    if (name) return name;
  }
  const tag = lastTag(xpath);
  const text = elementText.trim();
  return text ? `${tag} · ${text.length > 22 ? `${text.slice(0, 22)}…` : text}` : tag;
}

function lastTag(xpath: string): string {
  const part = xpath.split("/").pop() ?? "";
  const idMatch = part.match(/@id="([^"]+)"/);
  if (idMatch) return `#${idMatch[1]}`;
  const tagMatch = part.match(/^([a-zA-Z][\w-]*)/);
  return tagMatch ? `<${tagMatch[1]}>` : "element";
}
