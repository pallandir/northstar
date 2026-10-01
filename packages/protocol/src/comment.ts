import { z } from "zod";
import { assertSafeSourcePath } from "./source-path.js";

export const LIMITS = {
  text: 8_000,
  short: 2_000,
  url: 4_000,
  batch: 200,
  cid: 100,
  note: 2_000,
} as const;

const singleLine = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !/[\r\n\p{Zl}\p{Zp}]/u.test(value), "must be a single line");

const finite = z.number().finite();

export const commentStatusSchema = z.enum(["open", "in_progress", "resolved", "wontfix"]);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

export const intentSchema = z.enum(["change", "bug", "copy", "style", "question"]);
export type Intent = z.infer<typeof intentSchema>;

export const LOCATE_KINDS = [
  "source",
  "component",
  "routeFile",
  "testId",
  "aria",
  "text",
  "selector",
  "xpath",
] as const;
export const locateKindSchema = z.enum(LOCATE_KINDS);
export type LocateKind = z.infer<typeof locateKindSchema>;

export const locateConfidenceSchema = z.union([
  z.number().min(0).max(1),
  z.enum(["high", "medium", "low"]),
]);
export type LocateConfidence = z.infer<typeof locateConfidenceSchema>;

export const locateEntrySchema = z
  .object({
    kind: locateKindSchema,
    value: singleLine(LIMITS.short),
    confidence: locateConfidenceSchema,
  })
  .strict();
export type LocateEntry = z.infer<typeof locateEntrySchema>;

export const pageInfoSchema = z
  .object({
    title: singleLine(500).nullish(),
    colorScheme: singleLine(32).nullish(),
  })
  .strict();
export type PageInfo = z.infer<typeof pageInfoSchema>;

export const elementInfoSchema = z
  .object({
    ariaRole: singleLine(100).nullish(),
    ariaName: singleLine(500).nullish(),
    landmark: singleLine(200).nullish(),
    heading: singleLine(500).nullish(),
  })
  .strict();
export type ElementInfo = z.infer<typeof elementInfoSchema>;

export const resolutionSchema = z
  .object({
    by: z.string(),
    note: z.string().nullable(),
    files: z.array(z.string()),
    at: z.string(),
  })
  .strict();
export type Resolution = z.infer<typeof resolutionSchema>;

export const operationTypeSchema = z.enum(["comment", "style", "text"]);
export type OperationType = z.infer<typeof operationTypeSchema>;

export const sourceLocationSchema = z
  .object({
    path: z
      .string()
      .max(LIMITS.short)
      .superRefine((path, ctx) => {
        try {
          assertSafeSourcePath(path);
        } catch (error) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
        }
      }),
    line: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    via: z.string().max(LIMITS.short),
  })
  .strict();
export type SourceLocation = z.infer<typeof sourceLocationSchema>;

export const operationSchema = z
  .object({
    type: operationTypeSchema,
    property: z.string().max(LIMITS.short).nullable(),
    from: z.string().max(LIMITS.text).nullable(),
    to: z.string().max(LIMITS.text).nullable(),
  })
  .strict();
export type Operation = z.infer<typeof operationSchema>;

export const commentMetadataSchema = z
  .object({
    page: z.string().max(LIMITS.url),
    viewport: z.object({ w: finite, h: finite }).strict(),
    elementText: z.string().max(LIMITS.text),
  })
  .strict();
export type CommentMetadata = z.infer<typeof commentMetadataSchema>;

export const componentFrameSchema = z.object({ name: singleLine(200) }).strict();
export type ComponentFrame = z.infer<typeof componentFrameSchema>;

export const componentInfoSchema = z
  .object({ stack: z.array(componentFrameSchema).max(12) })
  .strict();
export type ComponentInfo = z.infer<typeof componentInfoSchema>;

export const routeInfoSchema = z
  .object({
    pattern: singleLine(LIMITS.short),
    params: z.record(z.string().max(200), z.string().max(500)).nullable(),
    router: singleLine(100),
    routeFile: singleLine(LIMITS.short).nullable(),
    confidence: z.enum(["exact", "inferred"]),
  })
  .strict();
export type RouteInfo = z.infer<typeof routeInfoSchema>;

export const targetAncestorSchema = z
  .object({
    tag: z.string().max(64),
    id: z.string().max(200).nullable(),
    classes: z.array(z.string().max(200)).max(20),
  })
  .strict();
export type TargetAncestor = z.infer<typeof targetAncestorSchema>;

export const targetSchema = z
  .object({
    selector: singleLine(LIMITS.short),
    tag: z.string().max(64),
    id: z.string().max(200).nullable(),
    testId: singleLine(200).nullable(),
    role: singleLine(100).nullable(),
    ariaLabel: singleLine(500).nullable(),
    classes: z.array(z.string().max(200)).max(20),
    attributes: z.record(z.string().max(100), z.string().max(500)),
    ownText: z.string().max(2000),
    ancestors: z.array(targetAncestorSchema).max(10),
    rect: z.object({ x: finite, y: finite, w: finite, h: finite }).strict(),
    outerHtml: z.string().max(2000),
  })
  .strict();
export type Target = z.infer<typeof targetSchema>;

export const screenshotDataUrlSchema = z
  .string()
  .regex(
    /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/,
    "must be a png, jpeg or webp data url",
  );

const httpUrl = z
  .string()
  .max(LIMITS.url)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an http or https url");

export const draftSchema = z
  .object({
    cid: z.string().min(1).max(LIMITS.cid),
    comment: z.string().max(LIMITS.text),
    operation: operationSchema,
    operator: z.string().max(LIMITS.url),
    url: httpUrl,
    metadata: commentMetadataSchema,
    source: sourceLocationSchema.nullish(),
    component: componentInfoSchema.nullish(),
    route: routeInfoSchema.nullish(),
    target: targetSchema.nullish(),
    screenshotDataUrl: screenshotDataUrlSchema.nullish(),
    attachScreenshot: z.boolean().optional(),
    planFirst: z.boolean().optional(),
    schemaVersion: z.number().int().min(1).max(99).optional(),
    intent: intentSchema.optional(),
    locate: z.array(locateEntrySchema).max(12).optional(),
    page: pageInfoSchema.optional(),
    element: elementInfoSchema.optional(),
  })
  .strict();
export type Draft = z.infer<typeof draftSchema>;

export interface Comment {
  id: string;
  createdAt: string;
  comment: string;
  operation: Operation;
  operator: string;
  url: string;
  metadata: CommentMetadata;
  status: CommentStatus;
  source: SourceLocation | null;
  component: ComponentInfo | null;
  route: RouteInfo | null;
  target: Target | null;
  screenshot: string | null;
  attachScreenshot: boolean;
  planFirst: boolean;
  cid: string;
  schemaVersion?: number;
  intent?: Intent;
  locate?: LocateEntry[];
  page?: PageInfo;
  element?: ElementInfo;
  resolution?: Resolution;
}

export interface DeferredComment {
  id: string;
  createdAt: string;
  page: string;
  operationType: OperationType;
  comment: string;
  reason: string;
  flaggedBy: "user" | "assistant";
  category: "needs-plan" | "feedback";
}

export interface DeferralNotice {
  commentId: string;
  page: string;
  summary: string;
  createdAt: string;
}
