import type { RuleContext } from "../context.js";
import type { RawFinding } from "../finding.js";

const MAX_SIZES = 8;
const LINE_CHARS = 90;
const AVERAGE_GLYPH = 0.52;
const PARAGRAPH_MIN = 100;
const SMALL_TEXT = 12;
const EVIDENCE_CAP = 5;
const MIN_TEXT = 3;

export function typeScale(ctx: RuleContext): RawFinding[] {
  const sizes = new Set(
    ctx.snapshot.nodes
      .filter((n) => n.kind === "text" || n.kind === "heading" || n.kind === "button")
      .map((n) => Math.round(n.style.fontSize)),
  );
  if (sizes.size <= MAX_SIZES) return [];
  return [
    {
      rule: "NS-TYPE-SCALE",
      confidence: 0.7,
      region: "page",
      evidence: [],
      message: `${sizes.size} distinct font sizes are in use (${[...sizes].sort((a, b) => a - b).join(", ")}), more than a scale needs.`,
    },
  ];
}

export function lineLength(ctx: RuleContext): RawFinding[] {
  return ctx.snapshot.nodes
    .filter((n) => n.kind === "text" && n.text.length >= PARAGRAPH_MIN && n.style.fontSize > 0)
    .filter((n) => n.box.width / (n.style.fontSize * AVERAGE_GLYPH) > LINE_CHARS)
    .slice(0, EVIDENCE_CAP)
    .map((n) => ({
      rule: "NS-PAGE-LINE-LENGTH",
      confidence: 0.8,
      region: ctx.regionOf(n),
      evidence: [n.selector],
      message: `A paragraph runs about ${Math.round(n.box.width / (n.style.fontSize * AVERAGE_GLYPH))} characters per line, past a comfortable 45 to 75.`,
    }));
}

export function headingOrder(ctx: RuleContext): RawFinding[] {
  const headings = ctx.snapshot.nodes.filter((n) => n.kind === "heading" && n.level !== null);
  const findings: RawFinding[] = [];
  const h1s = headings.filter((h) => h.level === 1);
  const make = (message: string, evidence: string[]): RawFinding => ({
    rule: "NS-PAGE-HEADING-ORDER",
    confidence: 0.95,
    region: "page",
    evidence,
    message,
  });
  if (headings.length > 0 && h1s.length === 0) findings.push(make("The page has no h1.", []));
  if (h1s.length > 1) {
    findings.push(
      make(
        `The page has ${h1s.length} h1 headings.`,
        h1s.map((h) => h.selector),
      ),
    );
  }
  let previous = 0;
  for (const heading of headings) {
    const level = heading.level as number;
    if (previous > 0 && level > previous + 1) {
      findings.push(
        make(`A level ${level} heading follows level ${previous}.`, [heading.selector]),
      );
    }
    previous = level;
  }
  return findings;
}

export function smallText(ctx: RuleContext): RawFinding[] {
  const small = ctx.snapshot.nodes.filter(
    (n) =>
      (n.kind === "text" || n.kind === "link" || n.kind === "button") &&
      n.text.length >= MIN_TEXT &&
      n.style.fontSize > 0 &&
      n.style.fontSize < SMALL_TEXT,
  );
  if (small.length === 0) return [];
  return [
    {
      rule: "NS-PAGE-SMALL-TEXT",
      confidence: 0.9,
      region: ctx.regionOf(small[0] as (typeof small)[number]),
      evidence: small.slice(0, EVIDENCE_CAP).map((n) => n.selector),
      message: `${small.length} text blocks are under ${SMALL_TEXT}px.`,
    },
  ];
}
