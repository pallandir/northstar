import { isOn, logFailure, refreshTitle, turnOff } from "./activation.js";
import { captureRegion } from "./lib/capture.js";
import { UserError, toFailure } from "./lib/errors.js";
import { isLocalUrl, originOf } from "./lib/origins.js";
import { pagePins } from "./lib/pins.js";
import { chooseServer } from "./lib/server.js";
import {
  clearAll,
  commentsForPage,
  dismissNotice,
  flush,
  removeComment,
  reopenComment,
  saveDraft,
  status,
  updateComment,
} from "./lib/transport.js";
import { type Message, type Response, parseMessage } from "./messages.js";
import { acceptPairToken, startPairing } from "./pairing.js";

interface SenderTab {
  id: number;
  windowId: number | undefined;
  active: boolean;
  url: string;
  origin: string;
}

function senderTab(sender: chrome.runtime.MessageSender): SenderTab {
  const tab = sender.tab;
  if (tab?.id === undefined || tab.url === undefined) {
    throw new UserError(
      "Northstar cannot read this tab's address.",
      "Click the Northstar icon to restore it.",
      "input",
    );
  }
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: tab.active,
    url: tab.url,
    origin: originOf(tab.url),
  };
}

function requireLocal(tab: SenderTab, action: string): void {
  if (!isLocalUrl(tab.url)) {
    throw new UserError(
      `${action} works on local pages only.`,
      "Use Handoff to export these comments.",
      "input",
    );
  }
}

function pageOnOrigin(tab: SenderTab, page: string): string {
  if (originOf(page) !== tab.origin) {
    throw new UserError(
      "That page does not belong to this tab.",
      "Reload the page and try again.",
      "input",
    );
  }
  return page;
}

async function dispatch(message: Message, sender: chrome.runtime.MessageSender): Promise<Response> {
  switch (message.type) {
    case "set-active":
    case "refresh":
      throw new UserError(
        "Northstar received a message meant for the page.",
        "Reload the page.",
        "input",
      );
    case "pair-token":
      await acceptPairToken(message, sender);
      return { ok: true };
    case "sync-active": {
      const tab = senderTab(sender);
      return { ok: true, active: await isOn(tab.id) };
    }
    case "deactivate":
      await turnOff(senderTab(sender).id);
      return { ok: true };
    case "connect": {
      const tab = senderTab(sender);
      requireLocal(tab, "Connect");
      await startPairing(tab.id, tab.origin);
      return { ok: true };
    }
    case "choose-server": {
      const tab = senderTab(sender);
      await chooseServer(tab.origin, message.port);
      return { ok: true, status: await status(tab.origin) };
    }
    case "capture-region": {
      const tab = senderTab(sender);
      if (!tab.active) {
        throw new UserError(
          "This tab is not in front.",
          "Switch to the tab and try again.",
          "input",
        );
      }
      return { ok: true, dataUrl: await captureRegion(tab.windowId, message.rect, message.dpr) };
    }
    case "save-request": {
      const tab = senderTab(sender);
      const item = await saveDraft(tab.origin, message.draft);
      return { ok: true, cid: item.cid, status: await status(tab.origin) };
    }
    case "page-comments": {
      const tab = senderTab(sender);
      const page = pageOnOrigin(tab, message.page);
      const { pins, problem } = await pagePins(tab.origin, page);
      return { ok: true, pins, page, problem };
    }
    case "get-comments": {
      const tab = senderTab(sender);
      return {
        ok: true,
        comments: await commentsForPage(tab.origin, pageOnOrigin(tab, message.page)),
      };
    }
    case "remove-comment": {
      const tab = senderTab(sender);
      await removeComment(tab.origin, message.cid);
      return { ok: true, status: await status(tab.origin) };
    }
    case "clear-all": {
      const tab = senderTab(sender);
      await clearAll(tab.origin);
      return { ok: true, status: await status(tab.origin) };
    }
    case "update-comment": {
      const tab = senderTab(sender);
      await updateComment(tab.origin, message.cid, message.text, {
        planFirst: message.planFirst,
        screenshotDataUrl: message.screenshotDataUrl,
      });
      return { ok: true, status: await status(tab.origin) };
    }
    case "flush": {
      const tab = senderTab(sender);
      requireLocal(tab, "Send to AI");
      const { status: st, send } = await flush(tab.origin);
      return { ok: true, status: st, send };
    }
    case "dismiss-notice": {
      const tab = senderTab(sender);
      requireLocal(tab, "Notices");
      await dismissNotice(tab.origin, message.commentId);
      return { ok: true, status: await status(tab.origin) };
    }
    case "reopen-comment": {
      const tab = senderTab(sender);
      requireLocal(tab, "Revert");
      await reopenComment(tab.origin, message.id, message.note);
      return { ok: true };
    }
    case "queue-status": {
      const tab = senderTab(sender);
      const st = await status(tab.origin);
      logFailure("title refresh", refreshTitle(tab.id, st));
      return { ok: true, status: st };
    }
  }
}

export async function handle(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  selfId: string,
): Promise<Response> {
  if (sender.id !== selfId) {
    return {
      ok: false,
      error: "Northstar refused a message from another extension.",
      fix: "Reload the page.",
    };
  }
  try {
    return await dispatch(parseMessage(raw), sender);
  } catch (err) {
    return toFailure(err);
  }
}
