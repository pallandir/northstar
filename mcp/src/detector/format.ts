import type { Finding } from "./types.js";

const ORDER = { error: 0, warn: 1, info: 2 } as const;

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule),
  );
}

export function formatText(findings: Finding[], limit?: number): string {
  const sorted = sortFindings(findings);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const lines = shown.map(
    (f) => `${f.file}:${f.line} ${f.rule} ${f.severity} ${f.message}. Fix: ${f.fix}`,
  );
  if (limit && sorted.length > limit)
    lines.push(`${sorted.length - limit} more findings not shown`);
  return lines.join("\n");
}

export function formatJson(findings: Finding[]): string {
  return JSON.stringify(sortFindings(findings), null, 2);
}

const SARIF_LEVEL = { error: "error", warn: "warning", info: "note" } as const;

export function formatSarif(findings: Finding[], version: string): string {
  const ruleIds = [...new Set(findings.map((f) => f.rule))].sort();
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "northstar",
              version,
              rules: ruleIds.map((id) => ({ id, helpUri: `northstar://canon/rules/${id}` })),
            },
          },
          results: sortFindings(findings).map((f) => ({
            ruleId: f.rule,
            level: SARIF_LEVEL[f.severity],
            message: { text: `${f.message}. Fix: ${f.fix}` },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: f.file },
                  region: { startLine: f.line },
                },
              },
            ],
          })),
        },
      ],
    },
    null,
    2,
  );
}

export function hookFeedback(findings: Finding[], cap = 5): string {
  const errors = sortFindings(findings).filter((f) => f.severity === "error");
  return formatText(errors, cap);
}
