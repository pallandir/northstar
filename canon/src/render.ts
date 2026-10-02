import type { Canon } from "./load.js";
import type { Rule } from "./schema.js";

export function renderRule(rule: Rule): string {
  const lines = [
    `# ${rule.id}: ${rule.title}`,
    "",
    `Severity: ${rule.severity}. Allowable: ${rule.allowable ? "yes, with a recorded reason" : "no"}. Detection: ${rule.detect}.`,
  ];
  if (rule.modes) {
    const overrides = Object.entries(rule.modes).map(([mode, severity]) => `${mode} ${severity}`);
    lines.push(`Per mode: ${overrides.join(", ")}.`);
  }
  if (rule.params) {
    for (const [key, value] of Object.entries(rule.params)) {
      lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
    }
  }
  lines.push("", `Why: ${rule.rationale}`, "", `Fix: ${rule.fix}`);
  return `${lines.join("\n")}\n`;
}

export function renderArbitration(canon: Canon): string {
  const lines = ["# Arbitration", "", "When guidance conflicts, the higher rank wins.", ""];
  for (const p of canon.arbitration.precedence) lines.push(`${p.rank}. **${p.name}**: ${p.rule}`);
  lines.push("", "## Resolved conflicts", "");
  for (const c of canon.arbitration.conflicts) {
    lines.push(`### ${c.topic}`, "", c.resolution, "");
    lines.push(`Rules: ${c.rules.map((id) => `\`${id}\``).join(", ")}`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
