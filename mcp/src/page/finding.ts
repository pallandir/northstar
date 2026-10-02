import type { Severity } from "@northstar/canon";
import type { ViewportName } from "./viewports.js";

export interface RawFinding {
  rule: string;
  confidence: number;
  region: string;
  evidence: string[];
  message: string;
}

export interface PageFinding extends RawFinding {
  severity: Exclude<Severity, "off">;
  viewports: ViewportName[];
}

export function findingKey(finding: Pick<PageFinding, "rule" | "evidence" | "message">): string {
  const where =
    finding.evidence.length > 0 ? finding.evidence.slice(0, 2).join(",") : finding.message;
  return `${finding.rule}|${where}`;
}
