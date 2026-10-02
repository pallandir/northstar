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

const BLOCKING_CONFIDENCE = 0.8;
const SIGNIFICANT_WARNING_CONFIDENCE = 0.9;

export const blocks = (finding: Pick<PageFinding, "severity" | "confidence">): boolean =>
  finding.severity === "error" && finding.confidence >= BLOCKING_CONFIDENCE;

export const isSignificant = (finding: Pick<PageFinding, "severity" | "confidence">): boolean =>
  blocks(finding) ||
  (finding.severity === "warn" && finding.confidence >= SIGNIFICANT_WARNING_CONFIDENCE);
