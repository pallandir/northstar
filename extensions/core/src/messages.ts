import { UserError } from "./lib/errors.js";
import type { Failure } from "./lib/errors.js";
import type { DraftRequest, OperationType, QueuedRequest, Rect, Rejection } from "./types.js";

export type PinStatus = "pending" | "processing" | "resolved" | "wontfix";

export interface PinOperation {
  property: string | null;
  from: string | null;
  to: string | null;
}

export interface PinModel {
  key: string;
  operator: string;
  text: string;
  status: PinStatus;
  kind: OperationType;
  removable: boolean;
  route: string;
  target: string;
  planFirst: boolean;
  hasScreenshot: boolean;
  operation?: PinOperation;
  sending?: boolean;
  rejection?: Rejection;
  missing?: boolean;
}

export interface DeferralNotice {
  commentId: string;
  page: string;
  summary: string;
  createdAt: string;
}

export interface TerminalStatus {
  available: boolean;
  driver?: string;
  reason?: string;
}

export interface SendOutcome {
  sent: number;
  rejected: number;
  reason?: string;
}

export interface HandoffNote {
  delivered: boolean;
  reason?: string;
  at: string;
}

export type Connection = "connected" | "offline" | "unpaired" | "choose" | "mismatch";

export interface ServerChoice {
  port: number;
  project: string;
}

export interface ProblemNote {
  error: string;
  fix: string;
}

export interface QueueStatus {
  queued: number;
  failed: number;
  connection: Connection;
  serverReachable: boolean;
  port: number | null;
  root: string | null;
  notices: DeferralNotice[];
  terminal: TerminalStatus;
  lastPolledAt: string | null;
  handoff: HandoffNote | null;
  servers: ServerChoice[];
  problem: ProblemNote | null;
}

export type Message =
  | { type: "set-active"; on: boolean }
  | { type: "refresh" }
  | { type: "sync-active" }
  | { type: "deactivate" }
  | { type: "connect" }
  | { type: "pair-token"; token: string; port: number }
  | { type: "choose-server"; port: number }
  | { type: "capture-region"; rect: Rect; dpr: number }
  | { type: "save-request"; draft: DraftRequest }
  | { type: "page-comments"; page: string }
  | { type: "get-comments"; page: string }
  | { type: "remove-comment"; cid: string }
  | { type: "clear-all" }
  | {
      type: "update-comment";
      cid: string;
      text: string;
      planFirst?: boolean;
      screenshotDataUrl?: string | null;
    }
  | { type: "flush" }
  | { type: "dismiss-notice"; commentId: string }
  | { type: "queue-status" }
  | { type: "reopen-comment"; id: string; note?: string };

export type Response =
  | {
      ok: true;
      status?: QueueStatus;
      send?: SendOutcome;
      dataUrl?: string;
      cid?: string;
      pins?: PinModel[];
      page?: string;
      problem?: ProblemNote | null;
      comments?: QueuedRequest[];
      active?: boolean;
    }
  | Failure;

function invalid(detail: string): UserError {
  console.error(`[northstar] invalid message: ${detail}`);
  return new UserError(
    "Northstar received a message it does not understand.",
    "Reload the page and try again.",
    "input",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw invalid(`${key} must be a string`);
  return value;
}

function number(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw invalid(`${key} must be a number`);
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw invalid(`${key} must be a boolean`);
  return value;
}

function parseRect(value: unknown): Rect {
  if (!isRecord(value)) throw invalid("rect must be an object");
  return {
    x: number(value, "x"),
    y: number(value, "y"),
    w: number(value, "w"),
    h: number(value, "h"),
  };
}

function parseDraft(value: unknown): DraftRequest {
  if (!isRecord(value)) throw invalid("draft must be an object");
  text(value, "comment");
  text(value, "url");
  text(value, "operator");
  if (!isRecord(value.operation)) throw invalid("draft.operation must be an object");
  if (!isRecord(value.metadata)) throw invalid("draft.metadata must be an object");
  return value as unknown as DraftRequest;
}

export function parseMessage(raw: unknown): Message {
  if (!isRecord(raw)) throw invalid("message is not an object");
  switch (raw.type) {
    case "set-active":
      if (typeof raw.on !== "boolean") throw invalid("on must be a boolean");
      return { type: "set-active", on: raw.on };
    case "refresh":
    case "sync-active":
    case "deactivate":
    case "connect":
    case "clear-all":
    case "flush":
    case "queue-status":
      return { type: raw.type };
    case "pair-token":
      return { type: "pair-token", token: text(raw, "token"), port: number(raw, "port") };
    case "choose-server":
      return { type: "choose-server", port: number(raw, "port") };
    case "capture-region":
      return { type: "capture-region", rect: parseRect(raw.rect), dpr: number(raw, "dpr") };
    case "save-request":
      return { type: "save-request", draft: parseDraft(raw.draft) };
    case "page-comments":
    case "get-comments":
      return { type: raw.type, page: text(raw, "page") };
    case "remove-comment":
      return { type: "remove-comment", cid: text(raw, "cid") };
    case "update-comment": {
      const shot = raw.screenshotDataUrl;
      if (shot !== undefined && shot !== null && typeof shot !== "string") {
        throw invalid("screenshotDataUrl must be a string or null");
      }
      return {
        type: "update-comment",
        cid: text(raw, "cid"),
        text: text(raw, "text"),
        planFirst: optionalBoolean(raw, "planFirst"),
        screenshotDataUrl: shot,
      };
    }
    case "dismiss-notice":
      return { type: "dismiss-notice", commentId: text(raw, "commentId") };
    case "reopen-comment": {
      const note = raw.note;
      if (note !== undefined && typeof note !== "string") throw invalid("note must be a string");
      return { type: "reopen-comment", id: text(raw, "id"), note };
    }
    default:
      throw invalid(`unknown type ${String(raw.type)}`);
  }
}
