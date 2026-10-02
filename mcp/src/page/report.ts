import { z } from "zod";
import type { Direction, Reference } from "../design/store.js";
import { diffFindings } from "./compare.js";
import { judge } from "./judge.js";
import type { Loop } from "./loop.js";
import type { RunRecord } from "./runs.js";

const AREAS: Array<[string, RegExp]> = [
  ["Accessibility", /^NS-A11Y-/],
  ["Responsive", /^NS-LAYOUT-RESPONSIVE$/],
  ["Hierarchy", /^NS-PAGE-(PRIMARY-ACTIONS|HEADING-ORDER)$/],
  ["Typography", /^NS-(TYPE-|PAGE-(LINE-LENGTH|SMALL-TEXT))/],
  ["Layout", /^NS-(SLOP-(NESTED-CARD|CARD-GRID)|PAGE-ALIGNMENT|LAYOUT-CENTER-EVERYTHING)$/],
  ["Colour", /^NS-COLOR-/],
  ["Originality", /^NS-PAGE-(GENERIC-HERO|ICON-SQUARES|GRADIENT)$/],
  ["Direction", /^NS-PAGE-DRIFT$/],
];

const LOW_CONFIDENCE = 0.8;
const UNRESOLVED_CAP = 8;

const reportSchema = z.object({
  createdAt: z.string(),
  url: z.string(),
  status: z.enum(["READY", "NOT READY"]),
  runs: z.array(z.string()),
  iterations: z.object({ used: z.number(), max: z.number() }),
  areas: z.array(
    z.object({ name: z.string(), status: z.enum(["PASS", "WARN", "FAIL"]), findings: z.number() }),
  ),
  resolved: z.array(z.string()),
  unresolved: z.array(
    z.object({
      rule: z.string(),
      severity: z.string(),
      confidence: z.number(),
      message: z.string(),
    }),
  ),
  direction: z.string().nullable(),
  references: z.array(
    z.object({ id: z.string(), title: z.string(), contributes: z.array(z.string()) }),
  ),
});

export type Report = z.infer<typeof reportSchema>;

interface ReportInput {
  loop: Loop;
  first: RunRecord;
  latest: RunRecord;
  direction: Direction | undefined;
  references: Reference[];
  now?: Date;
}

export function buildReport({
  loop,
  first,
  latest,
  direction,
  references,
  now = new Date(),
}: ReportInput): Report {
  const areas = AREAS.map(([name, pattern]) => {
    const mine = latest.findings.filter((f) => pattern.test(f.rule));
    const status: "PASS" | "WARN" | "FAIL" = mine.some((f) => f.severity === "error")
      ? "FAIL"
      : mine.length > 0
        ? "WARN"
        : "PASS";
    return { name, status, findings: mine.length };
  });
  const { resolved } = diffFindings(first, latest);
  const unresolved = judge(latest.findings, UNRESOLVED_CAP).map((f) => ({
    rule: f.rule,
    severity: f.severity,
    confidence: f.confidence,
    message: f.message,
  }));
  return {
    createdAt: now.toISOString(),
    url: latest.url,
    status: latest.findings.some((f) => f.severity === "error") ? "NOT READY" : "READY",
    runs: loop.runs,
    iterations: { used: loop.runs.length, max: loop.maxAudits },
    areas,
    resolved: resolved.map((f) => `${f.rule}: ${f.message}`),
    unresolved,
    direction: direction?.summary ?? null,
    references: references
      .filter((r) => r.contributes.length > 0)
      .map((r) => ({ id: r.id, title: r.title, contributes: r.contributes })),
  };
}

export function describeReport(report: Report): string {
  const rule = "------------------------";
  return [
    "NORTHSTAR DESIGN REVIEW",
    "",
    "Design direction",
    rule,
    report.direction ?? "No direction was built, the page was reviewed against the rules only.",
    "",
    "References",
    rule,
    report.references.length
      ? report.references
          .map((r) => `${r.id} ${r.title.slice(0, 60)} gives ${r.contributes.join(", ")}`)
          .join("\n")
      : "none used",
    "",
    "Quality",
    rule,
    ...report.areas.map(
      (a) => `${a.name.padEnd(14)} ${a.status}${a.findings ? ` (${a.findings})` : ""}`,
    ),
    "",
    "Unresolved observations",
    rule,
    ...(report.unresolved.length
      ? report.unresolved.map(
          (u) =>
            `${u.severity} ${u.rule}${u.confidence < LOW_CONFIDENCE ? " (low confidence)" : ""}: ${u.message}`,
        )
      : ["none"]),
    "",
    "Changes made",
    rule,
    ...(report.resolved.length
      ? report.resolved.map((r) => `resolved ${r}`)
      : ["none recorded between the first and last audit"]),
    "",
    "Iterations",
    rule,
    `${report.iterations.used} of ${report.iterations.max} audits`,
    "",
    "Status",
    rule,
    report.status,
  ].join("\n");
}
