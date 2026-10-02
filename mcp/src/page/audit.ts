import { type Canon, type Mode, severityFor } from "@northstar/canon";
import type { Dna } from "../design/dna.js";
import { createContext } from "./context.js";
import { type PageFinding, findingKey } from "./finding.js";
import { PAGE_RULES } from "./rules/index.js";
import type { PageSnapshot } from "./snapshot.js";
import { VIEWPORTS, type ViewportName } from "./viewports.js";

export interface AuditPolicy {
  canon: Canon;
  mode: Mode;
  allowed: (rule: string, path: string) => boolean;
  direction?: Dna;
}

export function auditSnapshot(
  snapshot: PageSnapshot,
  viewport: ViewportName,
  policy: AuditPolicy,
): PageFinding[] {
  const ctx = createContext(snapshot, viewport, policy.direction);
  const path = new URL(snapshot.url).pathname;
  const out: PageFinding[] = [];
  for (const rule of PAGE_RULES) {
    for (const raw of rule(ctx)) {
      const definition = policy.canon.rules.find((r) => r.id === raw.rule);
      if (!definition)
        throw new Error(`The page rule emitted ${raw.rule}, which the canon does not define.`);
      const severity = severityFor(definition, policy.mode);
      if (severity === "off") continue;
      if (definition.allowable && policy.allowed(raw.rule, path)) continue;
      out.push({ ...raw, severity, viewports: [viewport] });
    }
  }
  return out;
}

const widthOf = (viewports: readonly ViewportName[]): number =>
  Math.max(...viewports.map((v) => VIEWPORTS[v].width));

export function mergeViewports(perViewport: PageFinding[][]): PageFinding[] {
  const merged = new Map<string, PageFinding>();
  for (const findings of perViewport) {
    for (const finding of findings) {
      const key = findingKey(finding);
      const known = merged.get(key);
      if (!known) {
        merged.set(key, { ...finding });
        continue;
      }
      if (widthOf(finding.viewports) > widthOf(known.viewports)) {
        known.region = finding.region;
        known.message = finding.message;
      }
      known.viewports = [...new Set([...known.viewports, ...finding.viewports])];
      known.confidence = Math.max(known.confidence, finding.confidence);
    }
  }
  return [...merged.values()];
}
