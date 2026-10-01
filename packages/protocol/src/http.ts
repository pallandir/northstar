import { z } from "zod";
import type { DeferralNotice } from "./comment.js";
import type { Rejection } from "./draft-check.js";

export interface TerminalStatus {
  available: boolean;
  driver?: string;
  reason?: string;
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
  typed: boolean;
  channel?: boolean;
  driver?: string;
  reason?: string;
  at: string;
}

export interface StatusResponse {
  notices: DeferralNotice[];
  terminal: TerminalStatus;
  lastPolledAt: string | null;
  handoff: HandoffOutcome | null;
}

export interface AcceptedDraft {
  cid: string;
  id: string;
}

export interface PostCommentsResponse {
  ids: string[];
  accepted: AcceptedDraft[];
  rejected: Rejection[];
  typed: boolean;
  channel: boolean;
  reason?: string;
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
