import { z } from "zod";
import type { DeferralNotice } from "./comment.js";
import { PROTOCOL_VERSION } from "./constants.js";
import type { Rejection } from "./draft-check.js";

export const TEMPLATE_IDS = [
  "resolve",
  "implement",
  "explain",
  "fix",
  "review",
  "add-to-task",
] as const;
export const templateSchema = z.enum(TEMPLATE_IDS);
export type TemplateId = z.infer<typeof templateSchema>;

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  resolve: "Resolve the comments",
  implement: "Implement the comments",
  explain: "Explain the comments",
  fix: "Fix the problems reported",
  review: "Review the comments",
  "add-to-task": "Add the comments to the current task",
};

export const ACTIONS = [
  "system.info",
  "handoff.send",
  "project.list",
  "project.resolve",
  "status.get",
  "comments.list",
  "comments.add",
  "comments.clear",
  "comments.reopen",
  "notices.dismiss",
  "config.get",
  "config.set",
] as const;
export type NativeAction = (typeof ACTIONS)[number];

const root = z.string().min(1).max(4096);
const pageParam = z.string().min(1).max(4000);

export const actionParams = {
  "system.info": z.object({}).strict(),
  "handoff.send": z.object({ root, template: templateSchema }).strict(),
  "project.list": z.object({}).strict(),
  "project.resolve": z
    .object({
      paths: z.array(z.string().max(2000)).max(20),
      page: z.string().max(4000).optional(),
    })
    .strict(),
  "status.get": z.object({ root }).strict(),
  "comments.list": z.object({ root, page: pageParam }).strict(),
  "comments.add": z.object({ root, drafts: z.array(z.unknown()).min(1).max(200) }).strict(),
  "comments.clear": z
    .object({ root, page: pageParam.optional(), all: z.boolean().optional() })
    .strict(),
  "comments.reopen": z
    .object({ root, id: z.string().min(1).max(200), note: z.string().max(2000).optional() })
    .strict(),
  "notices.dismiss": z.object({ root, commentId: z.string().min(1).max(200) }).strict(),
  "config.get": z.object({}).strict(),
  "config.set": z
    .object({
      template: templateSchema.optional(),
      projects: z.record(z.string().min(1).max(500), z.string().min(1).max(4096)).optional(),
    })
    .strict(),
} as const satisfies Record<NativeAction, z.ZodTypeAny>;

export const requestSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    id: z.string().min(1).max(100),
    action: z.enum(ACTIONS),
    params: z.record(z.unknown()).optional(),
  })
  .strict();

export type ErrorCode =
  | "UNSUPPORTED_ACTION"
  | "BAD_REQUEST"
  | "VERSION_MISMATCH"
  | "NOT_LISTENING"
  | "BLOCKED"
  | "NO_PROJECT"
  | "REPLY_TOO_LARGE"
  | "DAEMON_UNAVAILABLE"
  | "INTERNAL";

export interface NativeSuccess<T = unknown> {
  version: typeof PROTOCOL_VERSION;
  id: string;
  ok: true;
  result: T;
}

export interface NativeFailure {
  version: typeof PROTOCOL_VERSION;
  id: string;
  ok: false;
  code: ErrorCode;
  error: string;
  fix: string;
}

export type NativeResponse<T = unknown> = NativeSuccess<T> | NativeFailure;

export interface Readiness {
  ready: boolean;
  working?: boolean;
  reason?: string;
  fix?: string;
}

export interface HandoffOutcome {
  delivered: boolean;
  blocked?: "busy";
  reason?: string;
  fix?: string;
  at: string;
}

export interface ProjectInfo {
  root: string;
  name: string;
}

export interface ProjectOwnership {
  root: string;
  matches: number;
  depth: number;
}

export interface ProjectResolution {
  owners: ProjectOwnership[];
  mapped: string | null;
}

export interface StatusResponse {
  notices: DeferralNotice[];
  readiness: Readiness;
  open: number;
  lastPolledAt: string | null;
  handoff: HandoffOutcome | null;
}

export interface UserConfig {
  template: TemplateId;
  projects: Record<string, string>;
}

export interface SystemInfo {
  version: string;
  protocol: number;
  pid: number;
  startedAt: string;
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
