import {
  type HandoffOutcome,
  type PostCommentsResponse,
  TEMPLATE_IDS,
  TEMPLATE_LABELS,
  type TemplateId,
  type UserConfig,
  templateSchema,
} from "@northstar/protocol";
import { callProject, requireConnected, resolveLink } from "./lib/bridge.js";
import { browser } from "./lib/browser.js";
import { UserError } from "./lib/errors.js";
import { request } from "./lib/native.js";
import { isLocalUrl, originOf } from "./lib/origins.js";
import { sendToAgent } from "./lib/transport.js";

export const COMMAND = "send-to-ai";
const SELECTION_ID = "northstar-selection";
const PAGE_ID = "northstar-page";
const AS_ID = "northstar-as";
const AS_PREFIX = `${AS_ID}:`;
const MAX_SELECTION = 8_000;
const BADGE_MS = 6_000;

const LOOPBACK_PATTERNS = ["http://localhost/*", "http://127.0.0.1/*", "http://*.localhost/*"];

export async function installMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: SELECTION_ID,
    title: "Send selection to AI",
    contexts: ["selection"],
  });
  browser.contextMenus.create({
    id: AS_ID,
    title: "Send selection to AI as",
    contexts: ["selection"],
  });
  for (const id of TEMPLATE_IDS) {
    browser.contextMenus.create({
      id: `${AS_PREFIX}${id}`,
      parentId: AS_ID,
      title: TEMPLATE_LABELS[id],
      contexts: ["selection"],
    });
  }
  browser.contextMenus.create({
    id: PAGE_ID,
    title: "Send comments to AI",
    contexts: ["page"],
    documentUrlPatterns: LOOPBACK_PATTERNS,
  });
}

interface PageRead {
  selection: string;
  title: string;
  width: number;
  height: number;
}

function readPage(): PageRead {
  return {
    selection: String(window.getSelection() ?? ""),
    title: document.title,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

async function pageOf(tabId: number): Promise<PageRead> {
  const [result] = await browser.scripting.executeScript({ target: { tabId }, func: readPage });
  if (!result?.result) {
    throw new UserError(
      "Northstar cannot read this page.",
      "Reload the page and try again.",
      "input",
    );
  }
  return result.result as PageRead;
}

async function defaultTemplate(): Promise<TemplateId> {
  return (await request<UserConfig>("config.get")).template;
}

function selectionDraft(url: string, page: PageRead, text: string): Record<string, unknown> {
  return {
    cid: crypto.randomUUID(),
    comment: text,
    operation: { type: "comment", property: null, from: null, to: null },
    operator: "",
    url,
    metadata: {
      page: new URL(url).pathname,
      viewport: { w: page.width, h: page.height },
      elementText: page.title.slice(0, MAX_SELECTION),
    },
    schemaVersion: 2,
    page: { title: page.title.slice(0, 500) },
  };
}

async function sendSelection(
  url: string,
  page: PageRead,
  template: TemplateId,
): Promise<HandoffOutcome> {
  const link = requireConnected(await resolveLink(originOf(url), url));
  const text = page.selection.trim().slice(0, MAX_SELECTION);
  const body = await callProject<PostCommentsResponse>(link, "comments.add", {
    drafts: [selectionDraft(url, page, text)],
  });
  if (body.accepted.length === 0) {
    const refusal = body.rejected[0];
    throw new UserError(
      refusal?.error ?? "Northstar did not accept the selection.",
      refusal?.fix ?? "Select less text and try again.",
      "input",
    );
  }
  return callProject<HandoffOutcome>(link, "session.send", { template });
}

async function sendPage(url: string, template: TemplateId): Promise<HandoffOutcome> {
  const { send } = await sendToAgent(originOf(url), { template });
  if (!send.woke) {
    throw new UserError(
      "There are no comments to send on this site.",
      "Add a comment with the Northstar toolbar first.",
      "input",
    );
  }
  return send.woke;
}

async function sendFromTab(tab: chrome.tabs.Tab, template?: TemplateId): Promise<HandoffOutcome> {
  const { id: tabId, url } = tab;
  if (tabId === undefined || url === undefined || !/^https?:/.test(url)) {
    throw new UserError(
      "Send to AI works on web pages only.",
      "Open the page you want to send from.",
      "input",
    );
  }
  const chosen = template ?? (await defaultTemplate());
  const page = await pageOf(tabId);
  if (page.selection.trim() !== "") return sendSelection(url, page, chosen);
  if (!isLocalUrl(url)) {
    throw new UserError(
      "Nothing is selected on this page.",
      "Select the text to send, then use Send to AI again.",
      "input",
    );
  }
  return sendPage(url, chosen);
}

async function report(tabId: number, text: string, title: string): Promise<void> {
  await browser.action.setBadgeText({ tabId, text });
  await browser.action.setTitle({ tabId, title });
  setTimeout(() => {
    void browser.action.setBadgeText({ tabId, text: "" });
  }, BADGE_MS);
}

export async function runSend(
  tab: chrome.tabs.Tab | undefined,
  template?: TemplateId,
): Promise<void> {
  const tabId = tab?.id;
  if (tab === undefined || tabId === undefined) return;
  try {
    const outcome = await sendFromTab(tab, template);
    if (outcome.delivered) {
      await report(tabId, "✓", `Northstar\nSent to ${outcome.session?.name ?? "your agent"}`);
    } else {
      await report(
        tabId,
        "!",
        `Northstar\n${outcome.reason ?? "The agent did not start."} ${outcome.fix ?? ""}`.trim(),
      );
    }
  } catch (err) {
    if (err instanceof UserError) {
      await report(tabId, "!", `Northstar\n${err.message} ${err.fix}`.trim());
      return;
    }
    console.error("[northstar] send failed", err);
    await report(tabId, "!", "Northstar\nSomething went wrong inside Northstar.");
  }
}

export function onMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  const id = String(info.menuItemId);
  if (id === SELECTION_ID || id === PAGE_ID) return runSend(tab);
  if (id.startsWith(AS_PREFIX)) {
    const template = templateSchema.safeParse(id.slice(AS_PREFIX.length));
    if (template.success) return runSend(tab, template.data);
  }
  return Promise.resolve();
}
