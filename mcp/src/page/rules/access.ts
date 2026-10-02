import type { RuleContext } from "../context.js";
import type { RawFinding } from "../finding.js";
import type { PageNode } from "../snapshot.js";

const EVIDENCE_CAP = 5;
const MIN_TARGET = 24;
const TOUCH_TARGET = 44;

export function focusVisible(ctx: RuleContext): RawFinding[] {
  const hidden = ctx.snapshot.nodes.filter((n) => n.interactive && n.focus === "none");
  if (hidden.length === 0) return [];
  return [
    {
      rule: "NS-A11Y-FOCUS-VISIBLE",
      confidence: 0.9,
      region: ctx.regionOf(hidden[0] as PageNode),
      evidence: hidden.slice(0, EVIDENCE_CAP).map((n) => n.selector),
      message: `${hidden.length} controls show no change when they take keyboard focus.`,
    },
  ];
}

function inlineLink(ctx: RuleContext, node: PageNode): boolean {
  if (node.kind !== "link") return false;
  const parent = ctx.parentOf(node);
  return parent?.kind === "text" && parent.text.length > node.text.length;
}

export function targetSize(ctx: RuleContext): RawFinding[] {
  const floor = ctx.isMobile ? TOUCH_TARGET : MIN_TARGET;
  const small = ctx.snapshot.nodes.filter(
    (n) =>
      n.interactive &&
      (n.kind === "button" || n.kind === "link" || n.kind === "field") &&
      !inlineLink(ctx, n) &&
      (n.box.width < floor || n.box.height < floor),
  );
  if (small.length === 0) return [];
  return [
    {
      rule: "NS-A11Y-TARGET-SIZE",
      confidence: 0.9,
      region: ctx.regionOf(small[0] as PageNode),
      evidence: small.slice(0, EVIDENCE_CAP).map((n) => n.selector),
      message: `${small.length} controls are smaller than ${floor} by ${floor} CSS pixels.`,
    },
  ];
}

export function semantics(ctx: RuleContext): RawFinding[] {
  const problems: { node: PageNode; reason: string }[] = [];
  for (const node of ctx.snapshot.nodes) {
    if (node.kind === "image" && node.tag === "img" && !node.hasAlt) {
      problems.push({ node, reason: "an image has no alt attribute" });
    } else if (node.kind === "field" && !node.labelled) {
      problems.push({ node, reason: "a field has no label" });
    } else if ((node.kind === "button" || node.kind === "link") && node.name === "") {
      problems.push({ node, reason: "a control has no accessible name" });
    }
  }
  if (problems.length === 0) return [];
  const reasons = [...new Set(problems.map((p) => p.reason))].join(", ");
  return [
    {
      rule: "NS-A11Y-SEMANTICS",
      confidence: 0.95,
      region: ctx.regionOf((problems[0] as { node: PageNode }).node),
      evidence: problems.slice(0, EVIDENCE_CAP).map((p) => p.node.selector),
      message: `${problems.length} elements fail semantics: ${reasons}.`,
    },
  ];
}
