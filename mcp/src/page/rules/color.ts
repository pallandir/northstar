import { composite, hex, hueOf, lightnessOf, ratio, saturationOf } from "../color.js";
import type { RuleContext } from "../context.js";
import type { RawFinding } from "../finding.js";
import type { PageNode } from "../snapshot.js";
import { plural } from "./util.js";

const NORMAL_RATIO = 4.5;
const LARGE_RATIO = 3;
const LARGE_SIZE = 24;
const LARGE_BOLD_SIZE = 18.66;
const BOLD = 700;
const EVIDENCE_CAP = 6;
const GREY_SATURATION = 0.12;
const SURFACE_SATURATION = 0.25;
const ACCENT_SATURATION = 0.4;
const ACCENT_LIGHTNESS: readonly [number, number] = [0.2, 0.8];
const HUE_BUCKET = 30;
const MAX_ACCENTS = 2;

const TEXT_KINDS: ReadonlySet<string> = new Set(["text", "heading", "button", "link"]);

export function requiredRatio(node: PageNode): number {
  const large =
    node.style.fontSize >= LARGE_SIZE ||
    (node.style.fontSize >= LARGE_BOLD_SIZE && node.style.fontWeight >= BOLD);
  return large ? LARGE_RATIO : NORMAL_RATIO;
}

export function contrastOf(node: PageNode): number {
  return ratio(composite(node.style.color, node.style.background), node.style.background);
}

function onImage(ctx: RuleContext, node: PageNode): boolean {
  return (
    node.style.backgroundImage !== "none" ||
    ctx.ancestorsOf(node).some((a) => a.style.backgroundImage !== "none")
  );
}

function textNodes(ctx: RuleContext): PageNode[] {
  return ctx.snapshot.nodes.filter(
    (n) => TEXT_KINDS.has(n.kind) && n.text.length > 0 && !onImage(ctx, n),
  );
}

export function contrast(ctx: RuleContext): RawFinding[] {
  const failing = new Map<string, { node: PageNode; value: number }[]>();
  for (const node of textNodes(ctx)) {
    const value = contrastOf(node);
    if (value >= requiredRatio(node)) continue;
    const region = ctx.regionOf(node);
    failing.set(region, [...(failing.get(region) ?? []), { node, value }]);
  }
  return [...failing].map(([region, items]) => {
    const worst = items.reduce((a, b) => (b.value < a.value ? b : a));
    return {
      rule: "NS-A11Y-CONTRAST",
      confidence: 0.95,
      region,
      evidence: items.slice(0, EVIDENCE_CAP).map((i) => i.node.selector),
      message: `Contrast fails on ${plural(items.length, "text block")}, the worst is ${worst.value.toFixed(1)}:1 for ${hex(worst.node.style.color)} on ${hex(worst.node.style.background)}.`,
    };
  });
}

export function greyOnColour(ctx: RuleContext): RawFinding[] {
  const hits = textNodes(ctx).filter(
    (n) =>
      saturationOf(n.style.color) < GREY_SATURATION &&
      lightnessOf(n.style.color) > 0.25 &&
      lightnessOf(n.style.color) < 0.8 &&
      saturationOf(n.style.background) > SURFACE_SATURATION,
  );
  if (hits.length === 0) return [];
  return [
    {
      rule: "NS-COLOR-GRAY-ON-COLOR",
      confidence: 0.8,
      region: ctx.regionOf(hits[0] as PageNode),
      evidence: hits.slice(0, EVIDENCE_CAP).map((n) => n.selector),
      message: `Grey text on a coloured surface in ${plural(hits.length, "block")}.`,
    },
  ];
}

export function accentBuckets(ctx: RuleContext): Map<number, PageNode[]> {
  const buckets = new Map<number, PageNode[]>();
  const note = (colour: PageNode["style"]["color"], node: PageNode) => {
    const lightness = lightnessOf(colour);
    if (colour[3] < 0.5 || saturationOf(colour) < ACCENT_SATURATION) return;
    if (lightness < ACCENT_LIGHTNESS[0] || lightness > ACCENT_LIGHTNESS[1]) return;
    const bucket = Math.floor(hueOf(colour) / HUE_BUCKET) % (360 / HUE_BUCKET);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), node]);
  };
  for (const node of ctx.snapshot.nodes) {
    if (node.style.backgroundImage === "none") note(node.style.ownBackground, node);
    if (node.kind === "link" || node.kind === "heading") note(node.style.color, node);
  }
  return buckets;
}

export function accents(ctx: RuleContext): RawFinding[] {
  const buckets = accentBuckets(ctx);
  if (buckets.size <= MAX_ACCENTS) return [];
  const evidence = [...buckets.values()].map((nodes) => (nodes[0] as PageNode).selector);
  return [
    {
      rule: "NS-COLOR-PALETTE-SIZE",
      confidence: 0.7,
      region: "page",
      evidence: evidence.slice(0, EVIDENCE_CAP),
      message: `${buckets.size} saturated hues compete as accents, one or two carry a palette.`,
    },
  ];
}
