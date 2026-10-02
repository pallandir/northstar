import type { RuleContext } from "../context.js";
import type { RawFinding } from "../finding.js";
import { type PageNode, rightOf } from "../snapshot.js";

const OVERFLOW_TOLERANCE = 2;
const EVIDENCE_CAP = 5;
const MIN_GRID_CARDS = 3;
const SIZE_TOLERANCE = 0.1;
const ROW_TOLERANCE = 4;
const MISALIGN_MIN = 1;
const MISALIGN_MAX = 6;
const CENTRED_SHARE = 0.75;
const CENTRED_MIN_NODES = 8;
const SHORT_TEXT = 3;

export function overflow(ctx: RuleContext): RawFinding[] {
  const width = ctx.snapshot.viewport.width;
  if (ctx.snapshot.document.width <= width + OVERFLOW_TOLERANCE) return [];
  const outside = ctx.snapshot.nodes
    .filter((n) => rightOf(n.box) > width + OVERFLOW_TOLERANCE)
    .slice(0, EVIDENCE_CAP);
  return [
    {
      rule: "NS-LAYOUT-RESPONSIVE",
      confidence: 1,
      region: outside[0] ? ctx.regionOf(outside[0]) : "page",
      evidence: outside.map((n) => n.selector),
      message: `The page is ${ctx.snapshot.document.width}px wide in a ${width}px viewport, so it scrolls sideways.`,
    },
  ];
}

export function nestedCards(ctx: RuleContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const node of ctx.snapshot.nodes) {
    if (!ctx.cardLike(node)) continue;
    const outer = ctx.ancestorsOf(node).find((a) => ctx.cardLike(a));
    if (!outer) continue;
    findings.push({
      rule: "NS-SLOP-NESTED-CARD",
      confidence: 0.85,
      region: ctx.regionOf(node),
      evidence: [outer.selector, node.selector],
      message: "A card sits inside another card, which flattens the hierarchy.",
    });
  }
  return findings.slice(0, EVIDENCE_CAP);
}

function similar(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(a, b) * SIZE_TOLERANCE;
}

function hasHeadingAndText(ctx: RuleContext, card: PageNode): boolean {
  const inside = ctx.snapshot.nodes.filter(
    (n) =>
      n.box.y >= card.box.y &&
      rightOf(n.box) <= rightOf(card.box) + 1 &&
      ctx.ancestorsOf(n).some((a) => a.id === card.id),
  );
  return (
    inside.some((n) => n.kind === "heading" || n.style.fontWeight >= 600) &&
    inside.some((n) => n.kind === "text")
  );
}

export function cardGrid(ctx: RuleContext): RawFinding[] {
  const byParent = new Map<number | null, PageNode[]>();
  for (const node of ctx.snapshot.nodes) {
    if (!ctx.cardLike(node)) continue;
    const list = byParent.get(node.parent) ?? [];
    list.push(node);
    byParent.set(node.parent, list);
  }
  const grids: PageNode[][] = [];
  for (const siblings of byParent.values()) {
    const first = siblings[0];
    if (!first) continue;
    const row = siblings.filter(
      (s) =>
        similar(s.box.width, first.box.width) &&
        similar(s.box.height, first.box.height) &&
        Math.abs(s.box.y - first.box.y) <= ROW_TOLERANCE,
    );
    if (row.length >= MIN_GRID_CARDS && row.every((c) => hasHeadingAndText(ctx, c)))
      grids.push(row);
  }
  return grids.map((row) => ({
    rule: "NS-SLOP-CARD-GRID",
    confidence: grids.length > 1 ? 0.9 : 0.8,
    region: ctx.regionOf(row[0] as PageNode),
    evidence: row.map((c) => c.selector).slice(0, EVIDENCE_CAP),
    message: `${row.length} identical cards in a row carry a heading and text each, which is the default scaffold.`,
  }));
}

export function alignment(ctx: RuleContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const lefts = new Map<string, Map<number, PageNode[]>>();
  for (const node of ctx.snapshot.nodes) {
    if (node.kind !== "text" && node.kind !== "heading" && node.kind !== "button") continue;
    if (node.style.textAlign === "center" || node.style.textAlign === "right") continue;
    const region = ctx.regionOf(node);
    const edges = lefts.get(region) ?? new Map<number, PageNode[]>();
    const list = edges.get(node.box.x) ?? [];
    list.push(node);
    edges.set(node.box.x, list);
    lefts.set(region, edges);
  }
  for (const [region, edges] of lefts) {
    const columns = [...edges.entries()]
      .filter(([, list]) => list.length >= 2)
      .sort(([a], [b]) => a - b);
    for (let i = 1; i < columns.length; i += 1) {
      const [prevX] = columns[i - 1] as [number, PageNode[]];
      const [x, list] = columns[i] as [number, PageNode[]];
      const gap = x - prevX;
      if (gap >= MISALIGN_MIN && gap <= MISALIGN_MAX) {
        findings.push({
          rule: "NS-PAGE-ALIGNMENT",
          confidence: 0.7,
          region,
          evidence: list.map((n) => n.selector).slice(0, 4),
          message: `Left edges sit ${gap}px apart in the same region, close enough to read as a mistake.`,
        });
      }
    }
  }
  return findings;
}

export function centred(ctx: RuleContext): RawFinding[] {
  if (ctx.isMobile) return [];
  const texts = ctx.snapshot.nodes.filter(
    (n) => (n.kind === "text" || n.kind === "heading") && n.text.length > SHORT_TEXT,
  );
  if (texts.length < CENTRED_MIN_NODES) return [];
  const centredNodes = texts.filter((n) => n.style.textAlign === "center");
  if (centredNodes.length / texts.length < CENTRED_SHARE) return [];
  return [
    {
      rule: "NS-LAYOUT-CENTER-EVERYTHING",
      confidence: 0.8,
      region: "page",
      evidence: centredNodes.slice(0, EVIDENCE_CAP).map((n) => n.selector),
      message: `${centredNodes.length} of ${texts.length} text blocks are centred.`,
    },
  ];
}
