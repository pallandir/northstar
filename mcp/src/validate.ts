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

const locateSchema = z
  .object({
    kind: z.enum([
      "source",
      "component",
      "routeFile",
      "testId",
      "aria",
      "text",
      "selector",
      "xpath",
    ]),
    value: z.string().max(MAX_SHORT),
    confidence: z.union([z.number().min(0).max(1), z.enum(["high", "medium", "low"])]),
  })
  .strict();

const pageSchema = z
  .object({
    title: z.string().max(500).nullish(),
    colorScheme: z.string().max(32).nullish(),
  })
  .strict();

const elementSchema = z
  .object({
    ariaRole: z.string().max(100).nullish(),
    ariaName: z.string().max(500).nullish(),
    landmark: z.string().max(200).nullish(),
    heading: z.string().max(500).nullish(),
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
    cid: z.string().min(1).max(100).optional(),
    schemaVersion: z.number().int().min(1).max(99).optional(),
    intent: z.enum(["change", "bug", "copy", "style", "question"]).optional(),
    locate: z.array(locateSchema).max(12).optional(),
    page: pageSchema.optional(),
    element: elementSchema.optional(),
  })
  .strict();

const MAX_BATCH = 200;

export const incomingBatchSchema = z.array(incomingCommentSchema).min(1).max(MAX_BATCH);

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clip = (value: unknown, max: number): unknown =>
  typeof value === "string" && value.length > max ? value.slice(0, max) : value;

function clipFields(obj: unknown, limits: Record<string, number>): void {
  if (!isObj(obj)) return;
  for (const [key, max] of Object.entries(limits)) {
    if (key in obj) obj[key] = clip(obj[key], max);
  }
}

function finiteFields(obj: unknown, keys: string[]): void {
  if (!isObj(obj)) return;
  for (const key of keys) {
    if (key in obj && (typeof obj[key] !== "number" || !Number.isFinite(obj[key]))) obj[key] = 0;
  }
}

function coerceStringRecord(value: unknown, maxKey: number, maxValue: number): unknown {
  if (!isObj(value)) return value;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key.length > maxKey) continue;
    const joined = Array.isArray(raw) ? raw.map(String).join(",") : raw;
    if (typeof joined === "string") out[key] = joined.slice(0, maxValue);
    else if (typeof joined === "number" || typeof joined === "boolean") out[key] = String(joined);
  }
  return out;
}

function clipStrings(value: unknown, max: number, count: number): unknown {
  if (!Array.isArray(value)) return value;
  return value.slice(0, count).map((v) => clip(v, max));
}

export function coerceItem(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const item: Obj = structuredClone(raw);
  clipFields(item, { comment: MAX_TEXT, operator: MAX_URL, url: MAX_URL, cid: 100 });
  clipFields(item.operation, { property: MAX_SHORT, from: MAX_TEXT, to: MAX_TEXT });
  if (isObj(item.metadata)) {
    clipFields(item.metadata, { page: MAX_URL, elementText: MAX_TEXT });
    finiteFields(item.metadata.viewport, ["w", "h"]);
  }
  if (isObj(item.route)) {
    clipFields(item.route, { pattern: MAX_SHORT, router: 100, routeFile: MAX_SHORT });
    if (item.route.params) item.route.params = coerceStringRecord(item.route.params, 200, 500);
  }
  if (isObj(item.component) && Array.isArray(item.component.stack)) {
    item.component.stack = item.component.stack.slice(0, 12).map((f) => {
      clipFields(f, { name: 200 });
      return f;
    });
  }
  if (isObj(item.target)) {
    const target = item.target;
    clipFields(target, {
      selector: MAX_SHORT,
      tag: 64,
      id: 200,
      testId: 200,
      role: 100,
      ariaLabel: 500,
      ownText: 2000,
      outerHtml: 2000,
    });
    target.classes = clipStrings(target.classes, 200, 20);
    if (target.attributes) target.attributes = coerceStringRecord(target.attributes, 100, 500);
    if (Array.isArray(target.ancestors)) {
      target.ancestors = target.ancestors.slice(0, 10).map((a) => {
        clipFields(a, { tag: 64, id: 200 });
        if (isObj(a)) a.classes = clipStrings(a.classes, 200, 20);
        return a;
      });
    }
    finiteFields(target.rect, ["x", "y", "w", "h"]);
  }
  if (Array.isArray(item.locate)) {
    item.locate = item.locate.slice(0, 12).map((entry) => {
      clipFields(entry, { value: MAX_SHORT });
      if (isObj(entry) && typeof entry.confidence === "number") {
        entry.confidence = Number.isFinite(entry.confidence)
          ? Math.min(1, Math.max(0, entry.confidence))
          : 0;
      }
      return entry;
    });
  }
  clipFields(item.page, { title: 500, colorScheme: 32 });
  clipFields(item.element, { ariaRole: 100, ariaName: 500, landmark: 200, heading: 500 });
  return item;
}

export interface ItemResult {
  index: number;
  cid: string | null;
  value?: IncomingComment;
  reason?: string;
}

export function parseIncoming(raw: string): IncomingComment {
  return incomingCommentSchema.parse(coerceItem(JSON.parse(raw))) as IncomingComment;
}

export function parseBatch(raw: string): IncomingComment[] {
  const parsed: unknown = JSON.parse(raw);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return incomingBatchSchema.parse(items.map(coerceItem)) as IncomingComment[];
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function parseBatchItems(raw: string): ItemResult[] {
  const parsed: unknown = JSON.parse(raw);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length === 0) throw new Error("empty batch");
  if (items.length > MAX_BATCH) throw new Error("batch too large");
  return items.map((item, index) => {
    const cid = isObj(item) && typeof item.cid === "string" ? item.cid.slice(0, 100) : null;
    const result = incomingCommentSchema.safeParse(coerceItem(item));
    return result.success
      ? { index, cid, value: result.data as IncomingComment }
      : { index, cid, reason: describeIssue(result.error) };
  });
}
