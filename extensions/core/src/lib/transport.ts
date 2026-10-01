import {
  type AgentInfo,
  type HandoffOutcome,
  type PostCommentsResponse,
  type Readiness,
  type TemplateId,
  type UserConfig,
  samePage,
} from "@northstar/protocol";
import type { DeferralNotice, ProblemNote, QueueStatus, SendOutcome } from "../messages.js";
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
import { type Link, callProject, requireConnected, resolveLink, toChoices } from "./bridge.js";
import { UserError } from "./errors.js";
import { BridgeError, request } from "./native.js";
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

type FlushCounts = Omit<SendOutcome, "woke">;

export interface FlushResult {
  status: QueueStatus;
  send: FlushCounts;
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
  readiness: Readiness;
  open: number;
  lastPolledAt: string | null;
  handoff: HandoffOutcome | null;
}

function parseReadiness(value: unknown): Readiness {
  if (
    !isRecord(value) ||
    typeof value.ready !== "boolean" ||
    !Array.isArray(value.sessions) ||
    typeof value.needsPick !== "boolean"
  ) {
    throw unreadable("status");
  }
  return value as unknown as Readiness;
}

function parseHandoff(value: unknown): HandoffOutcome | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.delivered !== "boolean" || typeof value.at !== "string") {
    throw unreadable("status");
  }
  return value as unknown as HandoffOutcome;
}

function parseStatusBody(value: unknown): StatusBody {
  if (!isRecord(value) || !Array.isArray(value.notices) || typeof value.open !== "number") {
    throw unreadable("status");
  }
  const polled = value.lastPolledAt;
  return {
    notices: value.notices as DeferralNotice[],
    readiness: parseReadiness(value.readiness),
    open: value.open,
    lastPolledAt: typeof polled === "string" ? polled : null,
    handoff: parseHandoff(value.handoff),
  };
}

function problemOf(err: BridgeError): ProblemNote {
  return { error: err.message, fix: err.fix };
}

const DEFAULT_TEMPLATE: TemplateId = "resolve";

function baseStatus(counts: { queued: number; failed: number }): QueueStatus {
  return {
    ...counts,
    connection: "offline",
    serverReachable: false,
    root: null,
    notices: [],
    readiness: null,
    open: 0,
    lastPolledAt: null,
    handoff: null,
    projects: [],
    agents: [],
    template: DEFAULT_TEMPLATE,
    problem: null,
  };
}

function statusFromLink(link: Link, counts: { queued: number; failed: number }): QueueStatus {
  const base = baseStatus(counts);
  switch (link.kind) {
    case "offline":
      return { ...base, problem: link.problem };
    case "noproject":
      return { ...base, connection: "noproject" };
    case "choose":
      return { ...base, connection: "choose", projects: toChoices(link.projects) };
    case "mismatch":
      return { ...base, connection: "mismatch", problem: link.problem };
    case "connected":
      return { ...base, connection: "connected", serverReachable: true, root: link.root };
  }
}

export async function status(origin: string): Promise<QueueStatus> {
  const counts = countFor(await listQueue(), origin);
  if (!isLocalUrl(origin)) return baseStatus(counts);

  const link = await resolveLink(origin);
  const base = statusFromLink(link, counts);
  if (link.kind !== "connected") return base;

  try {
    const body = parseStatusBody(await callProject(link, "status.get"));
    const config = await request<UserConfig>("config.get");
    const agents = body.readiness.sessions.length === 0 ? await installedAgents() : [];
    return { ...base, ...body, agents, template: config.template };
  } catch (err) {
    if (err instanceof BridgeError && err.kind === "api")
      return { ...base, problem: problemOf(err) };
    if (err instanceof BridgeError) return statusFromLink(await resolveLink(origin), counts);
    throw err;
  }
}

async function installedAgents(): Promise<AgentInfo[]> {
  const agents = await request<AgentInfo[]>("agent.list");
  return agents.filter((a) => a.installed && a.quickRun);
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
  const link = await resolveLink(origin, page);
  if (link.kind !== "connected") return { comments: [], problem: null };
  try {
    const body = await callProject(link, "comments.list", { page });
    if (!Array.isArray(body)) throw unreadable("comment list");
    const comments = body.map(parseServerComment).filter((c) => samePage(c.url, page));
    return { comments, problem: null };
  } catch (err) {
    if (err instanceof BridgeError && err.kind === "api") {
      return { comments: [], problem: problemOf(err) };
    }
    if (err instanceof BridgeError) return { comments: [], problem: null };
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
    if (link.kind === "connected") await callProject(link, "comments.clear", { all: true });
    else if (link.kind !== "offline" && link.kind !== "noproject") requireConnected(link);
  }
  await removeOrigin(origin);
}

export async function dismissNotice(origin: string, commentId: string): Promise<void> {
  const link = requireConnected(await resolveLink(origin));
  await callProject(link, "notices.dismiss", { commentId });
}

export async function reopenComment(origin: string, id: string, note?: string): Promise<void> {
  const link = requireConnected(await resolveLink(origin));
  await callProject(link, "comments.reopen", { id, note });
}

const unconfirmed: Rejection = {
  field: null,
  error: "The server did not confirm this comment.",
  fix: "Send it again.",
};

function parseRejections(body: PostCommentsResponse): Record<string, Rejection> {
  const out: Record<string, Rejection> = {};
  for (const entry of body.rejected) {
    if (!isRecord(entry)) throw unreadable("rejection");
    if (typeof entry.cid !== "string") continue;
    out[entry.cid] = {
      field: typeof entry.field === "string" ? entry.field : null,
      error: typeof entry.error === "string" ? entry.error : "The server rejected this comment.",
      fix: typeof entry.fix === "string" ? entry.fix : "Edit the comment and send it again.",
    };
  }
  return out;
}

function parsePostBody(value: unknown): PostCommentsResponse {
  if (!isRecord(value) || !Array.isArray(value.accepted) || !Array.isArray(value.rejected)) {
    throw unreadable("answer");
  }
  for (const entry of value.accepted) {
    if (!isRecord(entry) || typeof entry.cid !== "string") throw unreadable("answer");
  }
  return value as unknown as PostCommentsResponse;
}

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
  const drafts = batch.map(
    ({ queuedAt: _queuedAt, sendingAt: _sendingAt, rejection: _rejection, ...draft }) => draft,
  );

  let body: PostCommentsResponse;
  try {
    body = parsePostBody(await callProject(link, "comments.add", { drafts }));
  } catch (err) {
    await releaseSending(cids);
    throw err;
  }

  const accepted = body.accepted.map((entry) => entry.cid);
  const known = parseRejections(body);
  const fallback = body.rejected[0];
  const rejections: Record<string, Rejection> = {};
  for (const cid of cids) {
    if (accepted.includes(cid)) continue;
    rejections[cid] = known[cid] ?? unconfirmed;
  }
  await finishSend(cids, accepted, rejections);

  const send: FlushCounts = {
    sent: accepted.length,
    rejected: Object.keys(rejections).length,
    reason: accepted.length === 0 && fallback ? fallback.error : undefined,
  };
  return { status: await status(origin), send };
}

export interface SendOptions {
  sessionId?: string;
  template?: TemplateId;
}

async function templateFor(options: SendOptions): Promise<TemplateId> {
  if (options.template) return options.template;
  return (await request<UserConfig>("config.get")).template;
}

export async function sendToAgent(
  origin: string,
  options: SendOptions = {},
): Promise<{ status: QueueStatus; send: SendOutcome }> {
  const flushed = await flush(origin);
  if (flushed.status.open === 0) {
    return { status: flushed.status, send: { ...flushed.send, woke: null } };
  }
  const link = requireConnected(await resolveLink(origin));
  const template = await templateFor(options);
  const woke = parseHandoff(
    await callProject(link, "session.send", { template, sessionId: options.sessionId }),
  );
  return { status: await status(origin), send: { ...flushed.send, woke } };
}

export async function quickRun(
  origin: string,
  agent: string,
): Promise<{ status: QueueStatus; send: SendOutcome }> {
  const flushed = await flush(origin);
  if (flushed.status.open === 0) {
    return { status: flushed.status, send: { ...flushed.send, woke: null } };
  }
  const link = requireConnected(await resolveLink(origin));
  const template = await templateFor({});
  const woke = parseHandoff(await callProject(link, "quickrun.execute", { agent, template }));
  return { status: await status(origin), send: { ...flushed.send, woke } };
}
