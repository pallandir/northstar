import { z } from "zod";

const level = z.enum(["low", "medium", "high"]);
const words = z.array(z.string().min(1).max(60)).max(8);

export const intentSchema = z
  .object({
    product: z
      .object({
        category: z.string().max(80),
        surface: z.string().max(60),
        name: z.string().min(1).max(80).optional(),
        purpose: z.string().min(1).max(200).optional(),
      })
      .strict(),
    audience: words,
    personality: words,
    composition: z
      .object({ density: level, asymmetry: level, whitespace: level })
      .partial()
      .strict(),
    typography: z
      .object({ character: z.string().min(1).max(60) })
      .partial()
      .strict(),
    visual: z
      .object({ saturation: level, accentColors: z.number().int().min(0).max(4) })
      .partial()
      .strict(),
    avoid: words,
  })
  .strict();

export type Intent = z.infer<typeof intentSchema>;

export const intentPatchSchema = z
  .object({
    product: z
      .object({
        category: z.string().min(1).max(80),
        surface: z.string().min(1).max(60),
        name: z.string().min(1).max(80),
        purpose: z.string().min(1).max(200),
      })
      .partial()
      .strict(),
    audience: words,
    personality: words,
    composition: intentSchema.shape.composition,
    typography: intentSchema.shape.typography,
    visual: intentSchema.shape.visual,
    avoid: words,
  })
  .partial()
  .strict();

export type IntentPatch = z.infer<typeof intentPatchSchema>;

export const EMPTY_INTENT: Intent = {
  product: { category: "", surface: "" },
  audience: [],
  personality: [],
  composition: {},
  typography: {},
  visual: {},
  avoid: [],
};

export function mergeIntent(current: Intent | undefined, patch: IntentPatch): Intent {
  const base = current ?? EMPTY_INTENT;
  return {
    product: { ...base.product, ...patch.product },
    audience: patch.audience ?? base.audience,
    personality: patch.personality ?? base.personality,
    composition: { ...base.composition, ...patch.composition },
    typography: { ...base.typography, ...patch.typography },
    visual: { ...base.visual, ...patch.visual },
    avoid: patch.avoid ?? base.avoid,
  };
}

export function missingFromIntent(intent: Intent): string[] {
  const missing: string[] = [];
  if (!intent.product.category) missing.push("product.category");
  if (!intent.product.surface) missing.push("product.surface");
  if (intent.personality.length === 0) missing.push("personality");
  return missing;
}
