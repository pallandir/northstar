import { type Dna, dnaFromSnapshot } from "../../design/dna.js";
import type { RuleContext } from "../context.js";
import type { RawFinding } from "../finding.js";

const DENSITY_TOLERANCE = 0.25;
const SCALE_FLOOR = 0.6;
const ACCENT_SLACK = 1;
const RADIUS_ORDER = ["none", "low", "medium", "high"] as const;

function mismatches(target: Dna, actual: Dna): string[] {
  const out: string[] = [];
  const t = target;
  const a = actual;
  if (t.composition?.structure && t.composition.structure !== a.composition?.structure) {
    out.push(
      `composition is ${a.composition?.structure}, the direction is ${t.composition.structure}`,
    );
  }
  if (
    t.composition?.density !== undefined &&
    a.composition?.density !== undefined &&
    Math.abs(t.composition.density - a.composition.density) > DENSITY_TOLERANCE
  ) {
    out.push(`density is ${a.composition.density}, the direction is ${t.composition.density}`);
  }
  if (t.color?.background && t.color.background !== a.color?.background) {
    out.push(`the background is ${a.color?.background}, the direction is ${t.color.background}`);
  }
  if (
    t.color?.accentCount !== undefined &&
    (a.color?.accentCount ?? 0) > t.color.accentCount + ACCENT_SLACK
  ) {
    out.push(`${a.color?.accentCount} accent hues, the direction allows ${t.color.accentCount}`);
  }
  if (t.typography?.style && a.typography?.style && t.typography.style !== a.typography.style) {
    out.push(`type is ${a.typography.style}, the direction is ${t.typography.style}`);
  }
  if (
    t.typography?.headlineScale &&
    (a.typography?.headlineScale ?? 0) < t.typography.headlineScale * SCALE_FLOOR
  ) {
    out.push(
      `the headline is ${a.typography?.headlineScale}x body, the direction is ${t.typography.headlineScale}x`,
    );
  }
  if (t.geometry?.radius && a.geometry?.radius) {
    const gap = Math.abs(
      RADIUS_ORDER.indexOf(t.geometry.radius) - RADIUS_ORDER.indexOf(a.geometry.radius),
    );
    if (gap >= 2)
      out.push(`corners are ${a.geometry.radius}, the direction is ${t.geometry.radius}`);
  }
  return out;
}

export function drift(ctx: RuleContext): RawFinding[] {
  if (!ctx.direction || ctx.isMobile) return [];
  const found = mismatches(ctx.direction, dnaFromSnapshot(ctx.snapshot));
  if (found.length === 0) return [];
  return [
    {
      rule: "NS-PAGE-DRIFT",
      confidence: 0.75,
      region: "page",
      evidence: [],
      message: `The build drifts from the chosen direction: ${found.join("; ")}.`,
    },
  ];
}
