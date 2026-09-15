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

const componentSchema = z
  .object({
    stack: z.array(z.object({ name: z.string().max(200) }).strict()).max(12),
  })
  .strict();

const routeSchema = z
  .object({
    pattern: z.string().max(MAX_SHORT),
    params: z.record(z.string().max(200), z.string().max(500)).nullable(),
    router: z.string().max(100),
    routeFile: z.string().max(MAX_SHORT).nullable(),
    confidence: z.enum(["exact", "inferred"]),
  })
  .strict();

const targetAncestorSchema = z
  .object({
    tag: z.string().max(64),
    id: z.string().max(200).nullable(),
    classes: z.array(z.string().max(200)).max(20),
  })
  .strict();

const targetSchema = z
  .object({
    selector: z.string().max(MAX_SHORT),
    tag: z.string().max(64),
    id: z.string().max(200).nullable(),
    testId: z.string().max(200).nullable(),
    role: z.string().max(100).nullable(),
    ariaLabel: z.string().max(500).nullable(),
    classes: z.array(z.string().max(200)).max(20),
    attributes: z.record(z.string().max(100), z.string().max(500)),
    ownText: z.string().max(2000),
    ancestors: z.array(targetAncestorSchema).max(10),
    rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict(),
    outerHtml: z.string().max(2000),
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
    component: componentSchema.nullish(),
    route: routeSchema.nullish(),
    target: targetSchema.nullish(),
    screenshotDataUrl: screenshotSchema,
    attachScreenshot: z.boolean().optional(),
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
