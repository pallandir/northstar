import type { PageFinding } from "./finding.js";

const SEVERITY_WEIGHT = { error: 3, warn: 2, info: 1 } as const;
const REGION_IMPACT: Record<string, number> = { hero: 1, nav: 0.8, page: 0.7, footer: 0.4 };
const SECTION_IMPACT = 0.6;
const TASTE_COST = 2;
const OBJECTIVE_COST = 1;
const AUTOMATIC_CONFIDENCE = 0.9;
const TOP = 5;

const OBJECTIVE: readonly RegExp[] = [
  /^NS-A11Y-/,
  /^NS-LAYOUT-RESPONSIVE$/,
  /^NS-PAGE-HEADING-ORDER$/,
  /^NS-PAGE-SMALL-TEXT$/,
  /^NS-PAGE-LINE-LENGTH$/,
];

type Repairability = "automatic" | "suggest";

export interface JudgedFinding extends PageFinding {
  score: number;
  repair: Repairability;
}

const objective = (rule: string): boolean => OBJECTIVE.some((pattern) => pattern.test(rule));

export function judge(findings: readonly PageFinding[], limit: number = TOP): JudgedFinding[] {
  return findings
    .map((finding) => {
      const isObjective = objective(finding.rule);
      const impact = REGION_IMPACT[finding.region] ?? SECTION_IMPACT;
      const reach = Math.min(1, 0.6 + 0.1 * finding.evidence.length);
      const cost = isObjective ? OBJECTIVE_COST : TASTE_COST;
      const score =
        (SEVERITY_WEIGHT[finding.severity] * finding.confidence * impact * reach) / cost;
      const repair: Repairability =
        isObjective && finding.confidence >= AUTOMATIC_CONFIDENCE ? "automatic" : "suggest";
      return { ...finding, score: Math.round(score * 1000) / 1000, repair };
    })
    .sort((a, b) => b.score - a.score || a.rule.localeCompare(b.rule))
    .slice(0, limit);
}
