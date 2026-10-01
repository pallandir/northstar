import { z } from "zod";

export const DOMAINS = [
  "styles",
  "palettes",
  "typography",
  "products",
  "reasoning",
  "ux",
  "charts",
  "landing",
  "icons",
  "fonts",
] as const;

export const domainSchema = z.enum(DOMAINS);
export type Domain = z.infer<typeof domainSchema>;

export const modeSchema = z.enum(["operate", "read", "persuade", "experience"]);
export type Mode = z.infer<typeof modeSchema>;

export const rowSchema = z
  .object({
    id: z.string().min(1),
    domain: domainSchema,
    name: z.string().min(1),
    keywords: z.string(),
    summary: z.string(),
    modes: z.array(modeSchema),
    fields: z.record(z.string(), z.string()),
    caution: z.string().optional(),
  })
  .strict();

export type Row = z.infer<typeof rowSchema>;

export const manifestSchema = z
  .object({
    source: z.string(),
    sourceVersion: z.string(),
    license: z.string(),
    portedOn: z.string(),
    counts: z.record(z.string(), z.number()),
    dropped: z.record(z.string(), z.number()),
    cautioned: z.record(z.string(), z.number()),
  })
  .strict();

export type Manifest = z.infer<typeof manifestSchema>;
