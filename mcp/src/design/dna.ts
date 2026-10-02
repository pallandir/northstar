import { z } from "zod";
import { lightnessOf, saturationOf } from "../page/color.js";
import { createContext } from "../page/context.js";
import { accentBuckets } from "../page/rules/color.js";
import type { PageNode, PageSnapshot } from "../page/snapshot.js";

const level = z.enum(["low", "medium", "high"]);

export const DIMENSIONS = [
  "typography",
  "composition",
  "geometry",
  "color",
  "navigation",
  "interaction",
] as const;

export const dnaSchema = z
  .object({
    composition: z
      .object({
        structure: z.enum(["symmetric", "asymmetric", "mixed"]),
        density: z.number().min(0).max(1),
        whitespace: z.number().min(0).max(1),
        maxWidth: z.number().int().min(0).max(4000),
      })
      .partial(),
    typography: z
      .object({
        style: z.enum(["serif", "sans", "mono"]),
        headlineScale: z.number().min(0).max(40),
        weightContrast: level,
      })
      .partial(),
    geometry: z
      .object({
        radius: z.enum(["none", "low", "medium", "high"]),
        borderUsage: level,
        cardDensity: level,
      })
      .partial(),
    color: z
      .object({
        background: z.enum(["light", "dark"]),
        saturation: level,
        accentCount: z.number().int().min(0).max(12),
      })
      .partial(),
    hierarchy: z
      .object({
        primaryActions: z.number().int().min(0).max(20),
        heroFocus: z.enum(["headline", "image", "actions", "none"]),
      })
      .partial(),
    characteristics: z.array(z.string().max(40)).max(12),
  })
  .partial();

export type Dna = z.infer<typeof dnaSchema>;

const SERIF =
  /serif|georgia|times|garamond|playfair|fraunces|newsreader|lora|merriweather|cormorant|baskerville|didot|bodoni/i;
const MONO = /mono|code|courier|consolas|menlo|plex mono/i;
const LEAF_KINDS: ReadonlySet<string> = new Set([
  "text",
  "heading",
  "button",
  "link",
  "field",
  "image",
]);
const SCREENS = 3;
const ASYMMETRY_OFFSET = 0.08;
const SYMMETRY_OFFSET = 0.03;
const CENTRED_SHARE = 0.6;
const WEIGHT_STEPS = { medium: 100, high: 300 };
const RADIUS_STEPS = { low: 4, medium: 10 };
const BORDER_STEPS = { low: 0.2, medium: 0.6 };
const CARD_STEPS = { low: 1, medium: 5 };
const SATURATION_STEPS = { low: 0.25, medium: 0.55 };
const DARK_LIGHTNESS = 0.4;

const round = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

function bucket(value: number, steps: { low: number; medium: number }): "low" | "medium" | "high" {
  return value < steps.low ? "low" : value < steps.medium ? "medium" : "high";
}

function styleOf(display: PageNode | undefined): "serif" | "sans" | "mono" | undefined {
  if (!display) return undefined;
  const family = display.style.fontFamily;
  return MONO.test(family) ? "mono" : SERIF.test(family) ? "serif" : "sans";
}

export function dnaFromSnapshot(snapshot: PageSnapshot): Dna {
  const ctx = createContext(snapshot, snapshot.viewport.width < 600 ? "mobile" : "desktop");
  const { width, height } = snapshot.viewport;
  const leaves = snapshot.nodes.filter((n) => LEAF_KINDS.has(n.kind));
  const texts = leaves.filter((n) => n.kind === "text" || n.kind === "heading");
  const viewArea = width * Math.min(snapshot.document.height, height * SCREENS);
  const covered = leaves.reduce((sum, n) => sum + n.box.width * n.box.height, 0);
  const density = Math.min(1, covered / viewArea);

  const weightedX = texts.reduce(
    (sum, n) => sum + (n.box.x + n.box.width / 2) * n.box.width * n.box.height,
    0,
  );
  const textArea = texts.reduce((sum, n) => sum + n.box.width * n.box.height, 0) || 1;
  const offset = Math.abs(weightedX / textArea - width / 2) / width;
  const centredShare = texts.length
    ? texts.filter((n) => n.style.textAlign === "center").length / texts.length
    : 0;
  const structure =
    centredShare > CENTRED_SHARE || offset <= SYMMETRY_OFFSET
      ? "symmetric"
      : offset >= ASYMMETRY_OFFSET
        ? "asymmetric"
        : "mixed";
  const left = Math.min(...texts.map((n) => n.box.x), width);
  const right = Math.max(...texts.map((n) => n.box.x + n.box.width), 0);

  const body = texts.filter((n) => n.kind === "text");
  const h1 = snapshot.nodes.find((n) => n.kind === "heading" && n.level === 1);
  const bodySize = median(body.map((n) => n.style.fontSize)) || 16;
  const weightGap = h1 ? h1.style.fontWeight - median(body.map((n) => n.style.fontWeight)) : 0;

  const shapes = snapshot.nodes.filter((n) => n.interactive || n.kind === "surface");
  const radius = median(shapes.map((n) => n.style.radius));
  const surfaces = snapshot.nodes.filter((n) => n.kind === "surface" || n.kind === "landmark");
  const borderShare = surfaces.length
    ? surfaces.filter((n) => n.style.border).length / surfaces.length
    : 0;
  const cards = snapshot.nodes.filter((n) => ctx.cardLike(n)).length;
  const screens = Math.max(1, snapshot.document.height / height);

  const root = snapshot.nodes[0];
  const background = root?.style.background ?? [255, 255, 255, 1];
  const saturated = snapshot.nodes
    .map((n) =>
      n.kind === "link" || n.kind === "button"
        ? n.style.ownBackground[3] > 0.5
          ? n.style.ownBackground
          : n.style.color
        : null,
    )
    .filter((c): c is NonNullable<typeof c> => c !== null && saturationOf(c) > 0.1);
  const saturation = saturated.length
    ? saturated.reduce((s, c) => s + saturationOf(c), 0) / saturated.length
    : 0;

  const firstView = snapshot.nodes.filter((n) => n.box.y < height);
  const heaviest = firstView
    .filter(
      (n) =>
        n.kind === "heading" ||
        n.kind === "image" ||
        ((n.kind === "button" || n.kind === "link") && ctx.filled(n)),
    )
    .sort((a, b) => ctx.weight(b) - ctx.weight(a))[0];
  const heroFocus = !heaviest
    ? "none"
    : heaviest.kind === "heading"
      ? "headline"
      : heaviest.kind === "image"
        ? "image"
        : "actions";
  const primaryActions = firstView.filter(
    (n) => (n.kind === "button" || n.kind === "link") && ctx.filled(n) && ctx.regionOf(n) !== "nav",
  ).length;

  const dna: Dna = {
    composition: {
      structure,
      density: round(density),
      whitespace: round(1 - density),
      maxWidth: Math.max(0, Math.round(right - left)),
    },
    typography: {
      style: styleOf(h1 ?? [...texts].sort((a, b) => b.style.fontSize - a.style.fontSize)[0]),
      headlineScale: h1 ? round(h1.style.fontSize / bodySize, 1) : 0,
      weightContrast:
        weightGap >= WEIGHT_STEPS.high
          ? "high"
          : weightGap >= WEIGHT_STEPS.medium
            ? "medium"
            : "low",
    },
    geometry: {
      radius:
        radius === 0
          ? "none"
          : radius <= RADIUS_STEPS.low
            ? "low"
            : radius <= RADIUS_STEPS.medium
              ? "medium"
              : "high",
      borderUsage: bucket(borderShare, BORDER_STEPS),
      cardDensity: bucket(cards / screens, CARD_STEPS),
    },
    color: {
      background: lightnessOf(background) < DARK_LIGHTNESS ? "dark" : "light",
      saturation: bucket(saturation, SATURATION_STEPS),
      accentCount: accentBuckets(ctx).size,
    },
    hierarchy: { primaryActions, heroFocus },
  };
  dna.characteristics = characteristicsOf(dna);
  return dna;
}

export function characteristicsOf(dna: Dna): string[] {
  const tags: string[] = [];
  if (dna.composition?.structure === "asymmetric") tags.push("asymmetric");
  if (dna.composition?.structure === "symmetric") tags.push("centred");
  if (dna.color?.background) tags.push(dna.color.background);
  if (dna.geometry?.radius === "none" || dna.geometry?.radius === "low") tags.push("sharp");
  if (dna.geometry?.radius === "high") tags.push("rounded");
  if ((dna.composition?.whitespace ?? 0) >= 0.8) tags.push("spacious");
  if ((dna.composition?.density ?? 0) >= 0.5) tags.push("dense");
  if (dna.typography?.style === "serif") tags.push("serif");
  if (dna.typography?.style === "mono") tags.push("mono");
  if (dna.geometry?.cardDensity === "high") tags.push("card heavy");
  if (dna.color?.saturation === "low") tags.push("restrained");
  return tags;
}
