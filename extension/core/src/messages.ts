import type { DraftRequest, OperationType, QueuedRequest, Rect } from "./types.js";

export type PinStatus = "pending" | "open" | "processing" | "resolved" | "wontfix";

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
  typed: boolean;
  reason?: string;
}

export type Message =
  | { type: "set-active"; on: boolean }
  | { type: "sync-active"; tabId?: number }
  | { type: "set-overlay"; tabId: number; on: boolean }
  | { type: "tab-status"; tabId: number; url: string }
  | { type: "capture-region"; rect: Rect; dpr: number }
  | { type: "save-request"; draft: DraftRequest }
  | { type: "page-comments"; url: string }
  | { type: "get-comments"; url: string }
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

export interface QueueStatus {
  queued: number;
  serverReachable: boolean;
  port: number | null;
  root?: string | null;
  notices?: DeferralNotice[];
  version?: number | null;
  terminal?: TerminalStatus;
}

export type Response =
  | {
      ok: true;
      status?: QueueStatus;
      send?: SendOutcome;
      dataUrl?: string | null;
      cid?: string;
      pins?: PinModel[];
      comments?: QueuedRequest[];
      active?: boolean;
    }
  | { ok: false; error: string };
