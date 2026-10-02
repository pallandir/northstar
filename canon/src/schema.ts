import { z } from "zod";

export const MODES = ["operate", "read", "persuade", "experience"] as const;
export const STAGES = ["brief", "direction", "system", "compose", "critique", "polish"] as const;
export const SEVERITIES = ["off", "info", "warn", "error"] as const;
export const DETECTION = ["static", "tokens", "dom", "advisory"] as const;
export const SOURCES = [
  "impeccable",
  "frontend-design",
  "ui-ux-pro-max",
  "top-design",
  "taste-skill",
  "make-interfaces-feel-better",
  "emil-design-eng",
  "web-interface-guidelines",
  "shadcn-lint",
  "northstar",
] as const;

export const SHAPES = ["sharp", "crisp", "soft", "round"] as const;
export const TEMPERATURES = ["brand", "cool", "warm", "pure"] as const;
export const DENSITIES = ["airy", "balanced", "dense"] as const;
export const FEELS = ["snappy", "calm", "expressive"] as const;
export const BLEND_PARTS = ["surface", "type", "motion"] as const;

export const modeSchema = z.enum(MODES);
export const stageSchema = z.enum(STAGES);
export const severitySchema = z.enum(SEVERITIES);

const paramValue = z.union([z.string(), z.number(), z.array(z.string())]);

export const ruleSchema = z
  .object({
    id: z.string().regex(/^NS-[A-Z0-9]+(-[A-Z0-9]+)+$/),
    title: z.string().min(1),
    stage: z.array(stageSchema).min(1),
    severity: severitySchema,
    modes: z.record(modeSchema, severitySchema).optional(),
    allowable: z.boolean(),
    detect: z.enum(DETECTION),
    params: z.record(z.string(), paramValue).optional(),
    rationale: z.string().min(1),
    fix: z.string().min(1),
    sources: z.array(z.enum(SOURCES)).min(1),
  })
  .strict();

export const ruleListSchema = z.array(ruleSchema);

const stackNeedSchema = z
  .object({
    choice: z.string().min(1),
    package: z.string().optional(),
    install: z.string().optional(),
    mcp: z.string().optional(),
    modes: z.array(modeSchema).optional(),
  })
  .strict();

const needSchema = z
  .object({
    covers: z.array(z.string()).min(1),
    alternatives: z.array(z.string()).optional(),
  })
  .catchall(z.union([stackNeedSchema, z.array(z.string())]));

export const librariesSchema = z
  .object({
    stacks: z.record(
      z.string(),
      z
        .object({
          label: z.string(),
          detect: z.array(z.string()),
          extends: z.string().optional(),
        })
        .strict(),
    ),
    needs: z.record(z.string(), needSchema),
    external: z.array(z.object({ name: z.string(), use: z.string(), setup: z.string() }).strict()),
  })
  .strict();

export const rubricSchema = z
  .object({
    scale: z.object({ min: z.number(), max: z.number() }).strict(),
    purpose: z.string(),
    dimensions: z.record(z.string(), z.string()),
    weights: z.record(modeSchema, z.record(z.string(), z.number())),
    gates: z.record(z.string(), z.string()),
    bands: z.array(z.object({ min: z.number(), label: z.string() }).strict()),
  })
  .strict();

export const seedsSchema = z
  .object({
    hue: z.number().min(0).max(360),
    chroma: z.number().min(0.02).max(0.3),
    temperature: z.enum(TEMPERATURES),
    shape: z.enum(SHAPES),
    density: z.enum(DENSITIES),
    feel: z.enum(FEELS),
  })
  .strict();

export const archetypeSchema = z
  .object({
    id: z.string().regex(/^[a-z]+(-[a-z]+)*$/),
    title: z.string().min(1),
    summary: z.string().min(1),
    modes: z.array(modeSchema).min(1),
    seeds: seedsSchema,
    fonts: z
      .object({ heading: z.string().min(1), body: z.string().min(1), mono: z.string().min(1) })
      .strict(),
    depth: z.string().min(1),
    layout: z.array(z.string().min(1)).min(2),
    avoid: z.array(z.string().min(1)).min(1),
    dials: z
      .object({
        variance: z.number().int().min(1).max(10),
        motion: z.number().int().min(1).max(10),
        density: z.number().int().min(1).max(10),
      })
      .strict(),
  })
  .strict();

export const archetypesSchema = z
  .object({
    blend: z
      .object({
        takes: z.array(z.enum(BLEND_PARTS)).min(1),
        never: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    archetypes: z.array(archetypeSchema).min(1),
  })
  .strict();

export const synonymsSchema = z.record(z.string(), z.array(z.string().min(1)).min(1));

export const arbitrationSchema = z
  .object({
    precedence: z.array(
      z.object({ rank: z.number(), name: z.string(), rule: z.string() }).strict(),
    ),
    conflicts: z.array(
      z
        .object({
          id: z.string(),
          topic: z.string(),
          positions: z.record(z.string(), z.string()),
          resolution: z.string(),
          rules: z.array(z.string()).min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type Synonyms = z.infer<typeof synonymsSchema>;
export type Seeds = z.infer<typeof seedsSchema>;
export type Archetype = z.infer<typeof archetypeSchema>;
export type Archetypes = z.infer<typeof archetypesSchema>;
export type BlendPart = (typeof BLEND_PARTS)[number];
export type Mode = z.infer<typeof modeSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Libraries = z.infer<typeof librariesSchema>;
export type Rubric = z.infer<typeof rubricSchema>;
export type Arbitration = z.infer<typeof arbitrationSchema>;
