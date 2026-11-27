import type { DraftRequest, QueuedRequest, Rejection } from "../types.js";
import { browser } from "./browser.js";
import { UserError } from "./errors.js";
import { createLock } from "./lock.js";
import { originOf } from "./origins.js";

const QUEUE_KEY = "northstar-queue";
const SHOT_PREFIX = "northstar-shot:";
const INTERRUPTED_AFTER_MS = 120_000;

const locked = createLock();

const interrupted: Rejection = {
  field: null,
  error: "Sending was interrupted before the server answered.",
  fix: "Edit or delete this comment, then send again.",
};

function shotKey(cid: string): string {
  return `${SHOT_PREFIX}${cid}`;
}

function notFound(): UserError {
  return new UserError("That comment no longer exists.", "Reopen the comments panel.", "input");
}

async function read(): Promise<QueuedRequest[]> {
  const stored = await browser.storage.local.get(QUEUE_KEY);
  const queue: unknown = stored[QUEUE_KEY];
  if (queue === undefined) return [];
  if (!Array.isArray(queue)) {
    throw new UserError(
      "Northstar's saved comments are unreadable.",
      "Remove the extension data in the browser's extension settings and try again.",
    );
  }
  const items = queue as QueuedRequest[];
  const now = Date.now();
  let changed = false;
  const settled = items.map((item) => {
    if (item.sendingAt === undefined || now - item.sendingAt < INTERRUPTED_AFTER_MS) return item;
    changed = true;
    const { sendingAt: _sendingAt, ...rest } = item;
    return { ...rest, rejection: interrupted };
  });
  if (changed) await browser.storage.local.set({ [QUEUE_KEY]: settled });
  return changed ? settled : items;
}

function write(queue: QueuedRequest[], extra: Record<string, unknown> = {}): Promise<void> {
  return browser.storage.local.set({ [QUEUE_KEY]: queue, ...extra });
}

function inOrigin(item: QueuedRequest, origin: string): boolean {
  return originOf(item.url) === origin;
}

export function enqueue(draft: DraftRequest): Promise<QueuedRequest> {
  return locked(async () => {
    const queue = await read();
    const { screenshotDataUrl, ...rest } = draft;
    const item: QueuedRequest = {
      ...rest,
      screenshotDataUrl: null,
      cid: crypto.randomUUID(),
      queuedAt: Date.now(),
    };
    const extra: Record<string, unknown> = {};
    if (screenshotDataUrl) extra[shotKey(item.cid)] = screenshotDataUrl;
    await write([...queue, item], extra);
    return item;
  });
}

export function listQueue(): Promise<QueuedRequest[]> {
  return locked(read);
}

export async function listForOrigin(origin: string): Promise<QueuedRequest[]> {
  return (await listQueue()).filter((item) => inOrigin(item, origin));
}

export function countFor(
  queue: QueuedRequest[],
  origin: string,
): { queued: number; failed: number } {
  let queued = 0;
  let failed = 0;
  for (const item of queue) {
    if (!inOrigin(item, origin)) continue;
    if (item.rejection) failed++;
    else queued++;
  }
  return { queued, failed };
}

export async function withScreenshots(items: QueuedRequest[]): Promise<QueuedRequest[]> {
  const keys = items.filter((item) => item.attachScreenshot).map((item) => shotKey(item.cid));
  if (keys.length === 0) return items;
  const stored = await browser.storage.local.get(keys);
  return items.map((item) => {
    const shot: unknown = stored[shotKey(item.cid)];
    return typeof shot === "string" ? { ...item, screenshotDataUrl: shot } : item;
  });
}

export function removeItem(cid: string, origin: string): Promise<void> {
  return locked(async () => {
    const queue = await read();
    const item = queue.find((c) => c.cid === cid);
    if (!item || !inOrigin(item, origin)) throw notFound();
    await write(queue.filter((c) => c.cid !== cid));
    await browser.storage.local.remove(shotKey(cid));
  });
}

export function removeOrigin(origin: string): Promise<void> {
  return locked(async () => {
    const queue = await read();
    const gone = queue.filter((item) => inOrigin(item, origin));
    await write(queue.filter((item) => !inOrigin(item, origin)));
    if (gone.length > 0) await browser.storage.local.remove(gone.map((item) => shotKey(item.cid)));
  });
}

export function updateItem(
  cid: string,
  origin: string,
  text: string,
  opts: { planFirst?: boolean; screenshotDataUrl?: string | null } = {},
): Promise<void> {
  return locked(async () => {
    const queue = await read();
    const item = queue.find((c) => c.cid === cid);
    if (!item || !inOrigin(item, origin)) throw notFound();
    if (item.sendingAt !== undefined) {
      throw new UserError("This comment is being sent.", "Try again in a moment.", "input");
    }
    item.comment = text;
    item.rejection = undefined;
    if (opts.planFirst !== undefined) item.planFirst = opts.planFirst;
    const extra: Record<string, unknown> = {};
    if (typeof opts.screenshotDataUrl === "string") {
      extra[shotKey(cid)] = opts.screenshotDataUrl;
      item.attachScreenshot = true;
    }
    if (opts.screenshotDataUrl === null) item.attachScreenshot = false;
    await write(queue, extra);
    if (opts.screenshotDataUrl === null) await browser.storage.local.remove(shotKey(cid));
  });
}

export function beginSend(origin: string): Promise<QueuedRequest[]> {
  return locked(async () => {
    const queue = await read();
    const now = Date.now();
    const batch = queue.filter(
      (item) => inOrigin(item, origin) && !item.rejection && item.sendingAt === undefined,
    );
    for (const item of batch) item.sendingAt = now;
    if (batch.length > 0) await write(queue);
    return withScreenshots(batch);
  });
}

export function finishSend(
  batch: string[],
  accepted: string[],
  rejections: Record<string, Rejection>,
): Promise<void> {
  return locked(async () => {
    const queue = await read();
    const done = new Set(accepted);
    const inBatch = new Set(batch);
    const next: QueuedRequest[] = [];
    for (const item of queue) {
      if (done.has(item.cid)) continue;
      if (inBatch.has(item.cid)) {
        item.sendingAt = undefined;
        if (rejections[item.cid]) item.rejection = rejections[item.cid];
      }
      next.push(item);
    }
    await write(next);
    if (accepted.length > 0) await browser.storage.local.remove(accepted.map(shotKey));
  });
}

export function releaseSending(batch: string[]): Promise<void> {
  return finishSend(batch, [], {});
}
