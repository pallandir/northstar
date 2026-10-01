import { z } from "zod";
import type { DeferralNotice } from "./comment.js";
import type { Rejection } from "./draft-check.js";

export type AgentKind = "claude-code" | "codex" | "gemini" | "other";
export type DeliveryVia = "channel" | "terminal";

export interface AgentReadiness {
  ready: boolean;
  agent: AgentKind;
  via: DeliveryVia | null;
  driver?: string;
  reason?: string;
  fix?: string;
}

export const healthSchema = z.object({
  ok: z.literal(true),
  service: z.literal("northstar"),
  protocol: z.number().int(),
  version: z.string(),
  root: z.string(),
  startedAt: z.string(),
  paired: z.boolean(),
});
export type Health = z.infer<typeof healthSchema>;

export interface HandoffOutcome {
  delivered: boolean;
  agent: AgentKind;
  via: DeliveryVia | null;
  reason?: string;
  fix?: string;
  at: string;
}

export interface StatusResponse {
  notices: DeferralNotice[];
  agent: AgentReadiness;
  open: number;
  lastPolledAt: string | null;
  handoff: HandoffOutcome | null;
}

export interface OwnsResponse {
  matches: number;
  depth: number;
}

export interface AcceptedDraft {
  cid: string;
  id: string;
}

export interface PostCommentsResponse {
  ids: string[];
  accepted: AcceptedDraft[];
  rejected: Rejection[];
}

export interface DeleteCommentsResponse {
  removed: number;
}

export interface PairConfirmResponse {
  token: string;
}

export interface PairMessage {
  type: string;
  token: string;
  port: number;
}
