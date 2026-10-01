import { PAIR_MESSAGE, PAIR_PATH } from "@northstar/protocol";
import { logFailure } from "./activation.js";
import { browser } from "./lib/browser.js";
import { UserError } from "./lib/errors.js";
import { originOf } from "./lib/origins.js";
import { forgetServers, offlineError, pairUrl, resolveLink, setToken } from "./lib/server.js";
import type { Message } from "./messages.js";

const PENDING_KEY = "northstar-pairing";
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

interface Pending {
  tabId: number;
  port: number;
  originTabId: number;
}

async function readPending(): Promise<Pending | null> {
  const stored = await browser.storage.session.get(PENDING_KEY);
  const pending: unknown = stored[PENDING_KEY];
  return typeof pending === "object" && pending !== null ? (pending as Pending) : null;
}

export function relayPairMessages(messageType: string): void {
  const flag = "__northstarPairRelay";
  const w = window as unknown as Record<string, boolean>;
  if (w[flag]) return;
  w[flag] = true;
  const api = (globalThis as { browser?: typeof chrome }).browser ?? chrome;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as { type?: unknown; token?: unknown; port?: unknown } | null;
    if (!data || data.type !== messageType) return;
    Promise.resolve(
      api.runtime.sendMessage({ type: "pair-token", token: data.token, port: data.port }),
    ).catch((err: unknown) => console.error("[northstar] pairing failed", err));
  });
}

export async function startPairing(originTabId: number, pageOrigin: string): Promise<void> {
  const link = await resolveLink(pageOrigin);
  if (link.kind === "choose") {
    throw new UserError(
      "More than one Northstar server is running.",
      "Pick the project in the Northstar toolbar, then click Connect.",
      "choose",
    );
  }
  if (link.kind === "offline") throw offlineError();
  if (link.kind === "mismatch")
    throw new UserError(link.problem.error, link.problem.fix, "mismatch");
  const port = link.server.port;
  const tab = await browser.tabs.create({ url: pairUrl(port, PAIR_PATH), active: true });
  if (tab.id === undefined) {
    throw new UserError("Northstar could not open the pairing page.", "Try Connect again.");
  }
  const pending: Pending = { tabId: tab.id, port, originTabId };
  await browser.storage.session.set({ [PENDING_KEY]: pending });
}

export async function onPairTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
): Promise<void> {
  if (changeInfo.status !== "complete") return;
  const pending = await readPending();
  if (!pending || pending.tabId !== tabId) return;
  await browser.scripting.executeScript({
    target: { tabId },
    func: relayPairMessages,
    args: [PAIR_MESSAGE],
  });
}

export async function acceptPairToken(
  message: Extract<Message, { type: "pair-token" }>,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const pending = await readPending();
  const url = sender.tab?.url;
  if (
    !pending ||
    sender.tab?.id !== pending.tabId ||
    url === undefined ||
    originOf(url) !== `http://127.0.0.1:${pending.port}` ||
    message.port !== pending.port
  ) {
    throw new UserError(
      "Pairing was not started from Northstar.",
      "Click Connect in the Northstar toolbar.",
      "input",
    );
  }
  if (!TOKEN_SHAPE.test(message.token)) {
    throw new UserError(
      "The server sent an unreadable token.",
      "Update the Northstar server, then click Connect again.",
    );
  }
  await setToken(message.token);
  forgetServers();
  await browser.storage.session.remove(PENDING_KEY);
  await browser.tabs.remove(pending.tabId);
  logFailure(
    "refresh after pairing",
    browser.tabs.sendMessage(pending.originTabId, { type: "refresh" } satisfies Message),
  );
}
