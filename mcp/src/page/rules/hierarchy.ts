import type { RuleContext } from "../context.js";
import type { RawFinding } from "../finding.js";
import type { PageNode } from "../snapshot.js";
import { bottomOf } from "../snapshot.js";

const CLUSTER_GAP = 120;
const NEAR_EQUAL = 0.12;

function clusters(actions: PageNode[]): PageNode[][] {
  const sorted = [...actions].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const groups: PageNode[][] = [];
  for (const action of sorted) {
    const group = groups.find((g) =>
      g.some(
        (m) =>
          action.box.y - bottomOf(m.box) < CLUSTER_GAP &&
          m.box.y - bottomOf(action.box) < CLUSTER_GAP,
      ),
    );
    if (group) group.push(action);
    else groups.push([action]);
  }
  return groups;
}

export function primaryActions(ctx: RuleContext): RawFinding[] {
  const actions = ctx.snapshot.nodes.filter(
    (n) => (n.kind === "button" || n.kind === "link") && ctx.filled(n) && ctx.regionOf(n) !== "nav",
  );
  const findings: RawFinding[] = [];
  for (const group of clusters(actions)) {
    const distinct = group.filter((a, i) => group.findIndex((b) => b.text === a.text) === i);
    const heaviest = Math.max(...distinct.map((a) => ctx.weight(a)));
    const rivals = distinct.filter((a) => heaviest - ctx.weight(a) <= NEAR_EQUAL);
    if (rivals.length < 2) continue;
    findings.push({
      rule: "NS-PAGE-PRIMARY-ACTIONS",
      confidence: 0.9,
      region: ctx.regionOf(rivals[0] as PageNode),
      evidence: rivals.map((a) => a.selector),
      message: `${rivals.length} filled actions carry the same visual weight (${rivals
        .map((a) => `"${a.text}"`)
        .join(", ")}), so none reads as the primary one.`,
    });
  }
  return findings;
}
