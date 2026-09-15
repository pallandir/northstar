import { z } from "zod";
import type { IncomingComment } from "./types.js";

const MAX_TEXT = 8_000;
const MAX_SHORT = 2_000;
const MAX_URL = 4_000;

const sourceSchema = z
  .object({
    path: z
      .string()
      .max(MAX_SHORT)
      .refine((p) => !/[\p{Cc}~]/u.test(p), "invalid characters in source path")
      .refine((p) => !p.split(/[/\\]/).some((s) => s === ".."), "path traversal not allowed")
      .refine(
        (p) => !/^[a-zA-Z]:/.test(p) && !p.startsWith("\\\\"),
        "absolute drive paths not allowed",
      ),
    line: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    via: z.string().max(MAX_SHORT),
  })
  .strict();

const screenshotSchema = z
  .string()
  .regex(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/, "invalid screenshot data url")
  .nullish();

const operationSchema = z
  .object({
    type: z.enum(["comment", "style", "text"]),
    property: z.string().max(MAX_SHORT).nullable(),
    from: z.string().max(MAX_TEXT).nullable(),
    to: z.string().max(MAX_TEXT).nullable(),
  })
  .strict();

const metadataSchema = z
  .object({
    page: z.string().max(MAX_URL),
    viewport: z.object({ w: z.number(), h: z.number() }).strict(),
    elementText: z.string().max(MAX_TEXT),
  })
  .strict();

export const incomingCommentSchema = z
  .object({
    comment: z.string().max(MAX_TEXT),
    operation: operationSchema,
    operator: z.string().max(MAX_URL),
    url: z.string().max(MAX_URL),
    metadata: metadataSchema,
    source: sourceSchema.nullish(),
    screenshotDataUrl: screenshotSchema,
    planFirst: z.boolean().optional(),
  })
  .strict();

const MAX_BATCH = 200;

export const incomingBatchSchema = z.array(incomingCommentSchema).min(1).max(MAX_BATCH);

export function parseIncoming(raw: string): IncomingComment {
  return incomingCommentSchema.parse(JSON.parse(raw)) as IncomingComment;
}

export function parseBatch(raw: string): IncomingComment[] {
  const parsed: unknown = JSON.parse(raw);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return incomingBatchSchema.parse(items) as IncomingComment[];
}
