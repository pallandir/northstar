import { samePage } from "@northstar/protocol";
import type {
  DeferralNotice,
  HandoffNote,
  ProblemNote,
  QueueStatus,
  SendOutcome,
  TerminalStatus,
} from "../messages.js";
import type {
  CommentMetadata,
  ComponentInfo,
  DraftRequest,
  Operation,
  QueuedRequest,
  Rejection,
  RouteInfo,
  SourceLocation,
  Target,
} from "../types.js";
import { UserError } from "./errors.js";
import { isLocalUrl, originOf } from "./origins.js";
import {
  beginSend,
  countFor,
  enqueue,
  finishSend,
  listForOrigin,
  listQueue,
  releaseSending,
  removeItem,
  removeOrigin,
  updateItem,
  withScreenshots,
} from "./queue.js";
import {
  ApiFailure,
  type Link,
  callServer,
  requireConnected,
  resolveLink,
  toChoices,
} from "./server.js";

export type ServerStatus = "open" | "in_progress" | "resolved" | "wontfix";

export interface ServerComment {
  id: string;
  url: string;
  comment: string;
  operation: Operation;
  operator: string;
  metadata: CommentMetadata;
  status: ServerStatus;
  source?: SourceLocation | null;
  component?: ComponentInfo | null;
  route?: RouteInfo | null;
  target?: Target | null;
  screenshot?: string | null;
}

export interface FlushResult {
  status: QueueStatus;
  send: SendOutcome;
}

const SERVER_STATUSES: readonly string[] = ["open", "in_progress", "resolved", "wontfix"];

function unreadable(what: string): UserError {
  return new UserError(
    `The Northstar server sent an unreadable ${what}.`,
    "Update the Northstar server, then restart your AI agent.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseServerComment(value: unknown): ServerComment {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.url !== "string" ||
    typeof value.comment !== "string" ||
    typeof value.operator !== "string" ||
    typeof value.status !== "string" ||
    !SERVER_STATUSES.includes(value.status) ||
    !isRecord(value.operation) ||
    !isRecord(value.metadata)
  ) {
    throw unreadable("comment");
  }
  return value as unknown as ServerComment;
}

interface StatusBody {
  notices: DeferralNotice[];
  terminal: TerminalStatus;
  lastPolledAt: string | null;
  handoff: HandoffNote | null;
}

function parseHandoff(value: unknown): HandoffNote | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.typed !== "boolean" || typeof value.at !== "string") {
    throw unreadable("status");
  }
  return {
    delivered: value.typed || value.channel === true,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    at: value.at,
  };
}

function parseStatusBody(value: unknown): StatusBody {
  if (
    !isRecord(value) ||
    !Array.isArray(value.notices) ||
    !isRecord(value.terminal) ||
    typeof value.terminal.available !== "boolean"
  ) {
    throw unreadable("status");
  }
  const polled = value.lastPolledAt;
  return {
    notices: value.notices as DeferralNotice[],
    terminal: value.terminal as unknown as TerminalStatus,
    lastPolledAt: typeof polled === "string" ? polled : null,
    handoff: parseHandoff(value.handoff),
  };
}

function problemOf(err: ApiFailure): ProblemNote {
  return { error: err.message, fix: err.fix };
}

function baseStatus(counts: { queued: number; failed: number }): QueueStatus {
  return {
    ...counts,
    connection: "offline",
    serverReachable: false,
    port: null,
    root: null,
    notices: [],
    terminal: { available: false },
    lastPolledAt: null,
    handoff: null,
    servers: [],
    problem: null,
  };
}

function statusFromLink(link: Link, counts: { queued: number; failed: number }): QueueStatus {
  const base = baseStatus(counts);
  switch (link.kind) {
    case "offline":
      return base;
    case "choose":
      return { ...base, connection: "choose", servers: toChoices(link.servers) };
    case "mismatch":
      return {
        ...base,
        connection: "mismatch",
        port: link.server.port,
        root: link.server.root,
        problem: link.problem,
      };
    case "unpaired":
      return { ...base, connection: "unpaired", port: link.server.port, root: link.server.root };
    case "connected":
      return {
        ...base,
        connection: "connected",
        serverReachable: true,
        port: link.server.port,
        root: link.server.root,
      };
  }
}

export async function status(origin: string): Promise<QueueStatus> {
  const counts = countFor(await listQueue(), origin);
  if (!isLocalUrl(origin)) return baseStatus(counts);

  const link = await resolveLink(origin);
  const base = statusFromLink(link, counts);
  if (link.kind !== "connected") return base;

  try {
    const body = parseStatusBody(await callServer(link, "GET", "/status"));
    return { ...base, ...body };
  } catch (err) {
    if (err instanceof ApiFailure) return { ...base, problem: problemOf(err) };
    if (err instanceof UserError && (err.kind === "unpaired" || err.kind === "offline")) {
      return statusFromLink(await resolveLink(origin), counts);
    }
    throw err;
  }
}

export function saveDraft(origin: string, draft: DraftRequest): Promise<QueuedRequest> {
  if (originOf(draft.url) !== origin) {
    throw new UserError(
      "The page changed before the comment was saved.",
      "Pick the element again.",
      "input",
    );
  }
  return enqueue(draft);
}

export async function commentsForPage(origin: string, page: string): Promise<QueuedRequest[]> {
  const items = (await listForOrigin(origin)).filter((item) => samePage(item.url, page));
  return withScreenshots(items);
}

export async function queuedForPage(origin: string, page: string): Promise<QueuedRequest[]> {
  return (await listForOrigin(origin)).filter((item) => samePage(item.url, page));
}

export async function fetchServerComments(
  origin: string,
  page: string,
): Promise<{ comments: ServerComment[]; problem: ProblemNote | null }> {
  if (!isLocalUrl(origin)) return { comments: [], problem: null };
  const link = await resolveLink(origin);
  if (link.kind !== "connected") return { comments: [], problem: null };
  try {
    const body = await callServer(link, "GET", `/comments?page=${encodeURIComponent(page)}`);
    if (!Array.isArray(body)) throw unreadable("comment list");
    const comments = body.map(parseServerComment).filter((c) => samePage(c.url, page));
    return { comments, problem: null };
  } catch (err) {
    if (err instanceof ApiFailure) return { comments: [], problem: problemOf(err) };
    if (err instanceof UserError && (err.kind === "unpaired" || err.kind === "offline")) {
      return { comments: [], problem: null };
    }
    throw err;
  }
}

export function removeComment(origin: string, cid: string): Promise<void> {
  return removeItem(cid, origin);
}

export function updateComment(
  origin: string,
  cid: string,
  text: string,
  opts?: { planFirst?: boolean; screenshotDataUrl?: string | null },
): Promise<void> {
  return updateItem(cid, origin, text, opts);
}

export async function clearAll(origin: string): Promise<void> {
  if (isLocalUrl(origin)) {
    const link = await resolveLink(origin);
    if (link.kind !== "offline") {
      await callServer(requireConnected(link), "DELETE", "/comments?all=true");
    }
  }
  await removeOrigin(origin);
}

export async function dismissNotice(origin: string, commentId: string): Promise<void> {
  const link = requireConnected(await resolveLink(origin));
  await callServer(link, "POST", "/notices/dismiss", { commentId });
}

export async function reopenComment(origin: string, id: string, note?: string): Promise<void> {
  const link = requireConnected(await resolveLink(origin));
  await callServer(link, "POST", "/comments/reopen", { id, note });
}

interface SendBody {
  accepted: string[];
  rejections: Record<string, Rejection>;
  reason?: string;
  fallback?: Rejection;
}

function parseRejected(value: unknown): Record<string, Rejection> {
  if (!Array.isArray(value)) return {};
  const out: Record<string, Rejection> = {};
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.cid !== "string") throw unreadable("rejection");
    out[entry.cid] = {
      field: typeof entry.field === "string" ? entry.field : null,
      error: typeof entry.error === "string" ? entry.error : "The server rejected this comment.",
      fix: typeof entry.fix === "string" ? entry.fix : "Edit the comment and send it again.",
    };
  }
  return out;
}

function parseSendBody(value: unknown): SendBody {
  if (!isRecord(value) || !Array.isArray(value.accepted)) throw unreadable("answer");
  const accepted = value.accepted.map((entry) => {
    if (!isRecord(entry) || typeof entry.cid !== "string") throw unreadable("answer");
    return entry.cid;
  });
  return {
    accepted,
    rejections: parseRejected(value.rejected),
  };
}

const unconfirmed: Rejection = {
  field: null,
  error: "The server did not confirm this comment.",
  fix: "Send it again.",
};

const flushing = new Map<string, Promise<FlushResult>>();

export function flush(origin: string): Promise<FlushResult> {
  let running = flushing.get(origin);
  if (!running) {
    running = flushQueue(origin).finally(() => flushing.delete(origin));
    flushing.set(origin, running);
  }
  return running;
}

async function flushQueue(origin: string): Promise<FlushResult> {
  const link = requireConnected(await resolveLink(origin));
  const batch = await beginSend(origin);
  if (batch.length === 0) {
    return { status: await status(origin), send: { sent: 0, rejected: 0 } };
  }
  const cids = batch.map((item) => item.cid);
  const payload = batch.map(
    ({ queuedAt: _queuedAt, sendingAt: _sendingAt, rejection: _rejection, ...draft }) => draft,
  );

  let body: SendBody;
  let failure: UserError | null = null;
  try {
    body = parseSendBody(await callServer(link, "POST", "/comments", payload));
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 400 && isRecord(err.body)) {
      body = {
        accepted: [],
        rejections: parseRejected(err.body.rejected),
        reason: err.message,
        fallback: { field: null, error: err.message, fix: err.fix },
      };
      failure = err;
    } else {
      await releaseSending(cids);
      throw err;
    }
  }

  const rejections: Record<string, Rejection> = {};
  for (const cid of cids) {
    if (body.accepted.includes(cid)) continue;
    rejections[cid] = body.rejections[cid] ?? body.fallback ?? unconfirmed;
  }
  await finishSend(cids, body.accepted, rejections);

  const send: SendOutcome = {
    sent: body.accepted.length,
    rejected: Object.keys(rejections).length,
    reason: failure ? failure.message : undefined,
  };
  return { status: await status(origin), send };
}
