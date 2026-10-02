import type { RuleContext } from "../context.js";
import type { RawFinding } from "../finding.js";
import { type PageNode, bottomOf, centreX } from "../snapshot.js";

const CENTRE_TOLERANCE = 0.08;
const BADGE_MAX_CHARS = 30;
const SCREENSHOT_SHARE = 0.5;
const ROW_TOLERANCE = 24;
const MIN_ICON_TILES = 3;
const ICON_SIZE: readonly [number, number] = [24, 72];
const ICON_RADIUS = 6;
const EVIDENCE_CAP = 5;
const GRADIENT_SURFACE_SHARE = 0.1;
const GRADIENT_SURFACES = 3;
const HERO_SCORE = 3;

export function genericHero(ctx: RuleContext): RawFinding[] {
  const hero = ctx.snapshot.nodes.filter((n) => ctx.regionOf(n) === "hero");
  const h1 = hero.find((n) => n.kind === "heading" && n.level === 1);
  if (!h1) return [];
  const viewportCentre = ctx.snapshot.viewport.width / 2;
  const centred =
    h1.style.textAlign === "center" &&
    Math.abs(centreX(h1.box) - viewportCentre) <= ctx.snapshot.viewport.width * CENTRE_TOLERANCE;
  const badge = hero.some(
    (n) =>
      n.kind === "text" &&
      n.text.length <= BADGE_MAX_CHARS &&
      n.box.y < h1.box.y &&
      n.style.radius >= n.box.height / 2 - 1 &&
      (n.style.ownBackground[3] > 0 || n.style.border),
  );
  const buttons = hero.filter(
    (n) => (n.kind === "button" || n.kind === "link") && n.box.y > h1.box.y,
  );
  const row = buttons.some((a) =>
    buttons.some((b) => a.id !== b.id && Math.abs(a.box.y - b.box.y) <= ROW_TOLERANCE),
  );
  const lastButton = Math.max(0, ...buttons.map((b) => bottomOf(b.box)));
  const screenshot = hero.some(
    (n) =>
      (n.kind === "image" || ctx.cardLike(n)) &&
      n.box.y >= lastButton - ROW_TOLERANCE &&
      n.box.width >= ctx.snapshot.viewport.width * SCREENSHOT_SHARE,
  );
  const parts = [centred, badge, row, screenshot];
  const score = parts.filter(Boolean).length;
  if (score < HERO_SCORE) return [];
  return [
    {
      rule: "NS-PAGE-GENERIC-HERO",
      confidence: Math.min(0.95, 0.5 + 0.12 * score),
      region: "hero",
      evidence: [h1.selector],
      message: `The hero matches the default template (${[
        centred && "centred headline",
        badge && "pill badge",
        row && "two actions in a row",
        screenshot && "large product image below",
      ]
        .filter(Boolean)
        .join(", ")}).`,
    },
  ];
}

export function iconSquares(ctx: RuleContext): RawFinding[] {
  const tiles = ctx.snapshot.nodes.filter(
    (n) =>
      n.svgOnly &&
      n.box.width >= ICON_SIZE[0] &&
      n.box.width <= ICON_SIZE[1] &&
      Math.abs(n.box.width - n.box.height) <= 4 &&
      n.style.radius >= ICON_RADIUS &&
      (n.style.ownBackground[3] >= 0.5 || n.style.border),
  );
  if (tiles.length < MIN_ICON_TILES) return [];
  return [
    {
      rule: "NS-PAGE-ICON-SQUARES",
      confidence: 0.8,
      region: ctx.regionOf(tiles[0] as PageNode),
      evidence: tiles.slice(0, EVIDENCE_CAP).map((n) => n.selector),
      message: `${tiles.length} icons sit in rounded tiles of the same size.`,
    },
  ];
}

export function gradients(ctx: RuleContext): RawFinding[] {
  const text = ctx.snapshot.nodes.filter((n) => n.style.gradientText);
  const area = ctx.snapshot.viewport.width * ctx.snapshot.viewport.height;
  const surfaces = ctx.snapshot.nodes.filter(
    (n) =>
      n.style.backgroundImage === "gradient" &&
      !n.style.gradientText &&
      n.box.width * n.box.height >= area * GRADIENT_SURFACE_SHARE,
  );
  const findings: RawFinding[] = [];
  if (text.length > 0) {
    findings.push({
      rule: "NS-PAGE-GRADIENT",
      confidence: 0.9,
      region: ctx.regionOf(text[0] as PageNode),
      evidence: text.slice(0, EVIDENCE_CAP).map((n) => n.selector),
      message: `${text.length} headings use gradient text.`,
    });
  }
  if (surfaces.length >= GRADIENT_SURFACES) {
    findings.push({
      rule: "NS-PAGE-GRADIENT",
      confidence: 0.75,
      region: "page",
      evidence: surfaces.slice(0, EVIDENCE_CAP).map((n) => n.selector),
      message: `${surfaces.length} large surfaces use a gradient fill.`,
    });
  }
  return findings;
}
