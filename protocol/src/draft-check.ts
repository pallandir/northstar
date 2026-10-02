import type { z } from "zod";
import { type Draft, LIMITS, draftSchema } from "./comment.js";
import type { ApiError } from "./errors.js";

export interface Rejection extends ApiError {
  cid: string | null;
  field: string;
}

export interface DraftCheck {
  index: number;
  cid: string | null;
  draft?: Draft;
  rejection?: Rejection;
}

export const DRAFT_FIX =
  "Correct that field in the comment and save it again, or delete the comment.";

function describe(issue: z.ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" ? "is required" : `must be ${article(issue.expected)}`;
    case "too_big":
      return `must be at most ${issue.maximum} ${issue.type === "string" ? "characters" : "items"}`;
    case "too_small":
      return issue.type === "string" && issue.minimum === 1
        ? "must not be empty"
        : `must be at least ${issue.minimum}`;
    case "invalid_enum_value":
      return `must be one of ${issue.options.join(", ")}`;
    case "unrecognized_keys":
      return `has unknown keys ${issue.keys.join(", ")}`;
    case "invalid_union":
      return "has an invalid value";
    default:
      return issue.message.charAt(0).toLowerCase() + issue.message.slice(1);
  }
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

export function rejectionFromIssue(issue: z.ZodIssue, cid: string | null): Rejection {
  const path = issue.path.join(".");
  const unknownKeys = issue.code === "unrecognized_keys";
  const field = path || (unknownKeys ? issue.keys.join(", ") : "comment");
  const subject = unknownKeys && path === "" ? "The comment" : `The ${field} field`;
  return {
    cid,
    field,
    error: `${subject} ${describe(issue)}.`,
    fix: DRAFT_FIX,
  };
}

function cidOf(item: unknown): string | null {
  if (typeof item !== "object" || item === null) return null;
  const cid = (item as { cid?: unknown }).cid;
  return typeof cid === "string" && cid.length > 0 ? cid.slice(0, LIMITS.cid) : null;
}

export function checkDraft(item: unknown, index: number): DraftCheck {
  const cid = cidOf(item);
  const result = draftSchema.safeParse(item);
  if (result.success) return { index, cid, draft: result.data };
  const issue = result.error.issues[0] as z.ZodIssue;
  return { index, cid, rejection: rejectionFromIssue(issue, cid) };
}

export function checkDrafts(items: unknown[]): DraftCheck[] {
  return items.map(checkDraft);
}
