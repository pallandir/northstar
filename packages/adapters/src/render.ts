import type { Canon, Rule } from "@northstar/canon";

export const STAGE_ARTIFACTS = [
  { topic: "brief", label: "Brief", artifact: "`PRODUCT.md`" },
  { topic: "direction", label: "Direction", artifact: "entry in `design/decisions.md`" },
  { topic: "system", label: "System", artifact: "`DESIGN.md`" },
  { topic: "compose", label: "Compose", artifact: "code" },
  { topic: "critique", label: "Critique", artifact: "critique entry in the decisions log" },
  { topic: "polish", label: "Polish", artifact: "detector clean or allow listed" },
] as const;

const STAGE_TOPICS: ReadonlySet<string> = new Set(STAGE_ARTIFACTS.map((s) => s.topic));

export function fill(template: string, values: Record<string, string>): string {
  const filled = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`template placeholder ${key} has no value`);
    return value;
  });
  return filled;
}

export function stageTable(): string {
  return STAGE_ARTIFACTS.map(
    (s) => `| ${s.label} | ${s.artifact} | \`references/${s.topic}.md\` |`,
  ).join("\n");
}

export function lensTable(canon: Canon): string {
  return canon.references
    .filter((r) => !STAGE_TOPICS.has(r.topic))
    .map((r) => `| \`references/${r.topic}.md\` | ${r.loadWhen.replace(/\.$/, "")} |`)
    .join("\n");
}

export function craftFloor(canon: Canon): string {
  return canon.rules
    .filter((r) => r.severity === "error" && !r.id.startsWith("NS-A11Y-"))
    .map((r) => `- \`${r.id}\`: ${r.title}`)
    .join("\n");
}

export function renderSkill(canon: Canon, template: string, version: string): string {
  return fill(template, {
    VERSION: version,
    STAGE_TABLE: stageTable(),
    LENS_TABLE: lensTable(canon),
    CRAFT_FLOOR: craftFloor(canon),
  });
}

const GROUP_TITLES: Record<string, string> = {
  A11Y: "Accessibility floor",
  SLOP: "Anti slop",
  LOOK: "Default looks",
  TYPE: "Typography",
  COLOR: "Colour",
  MOTION: "Motion",
  LAYOUT: "Layout",
  LIB: "Library first",
  COPY: "Copy",
};

function ruleRow(rule: Rule): string {
  const allow = rule.allowable ? "yes" : "no";
  return `| \`${rule.id}\` | ${rule.title} | ${rule.severity} | ${allow} | ${rule.detect} |`;
}

export function renderRuleIndex(canon: Canon): string {
  const groups = new Map<string, Rule[]>();
  for (const rule of canon.rules) {
    const group = rule.id.split("-")[1] ?? "OTHER";
    groups.set(group, [...(groups.get(group) ?? []), rule]);
  }

  const lines = [
    "# Northstar rule index",
    "",
    "Generated from `canon/rules`. Do not edit by hand.",
    "",
    `${canon.rules.length} rules. Severity is the default, modes can raise or lower it.`,
  ];
  for (const [group, rules] of groups) {
    lines.push("", `## ${GROUP_TITLES[group] ?? group}`, "");
    lines.push("| Rule | Title | Severity | Allowable | Detection |", "|---|---|---|---|---|");
    lines.push(...rules.map(ruleRow));
  }

  lines.push("", "## Precedence", "");
  for (const p of canon.arbitration.precedence) lines.push(`${p.rank}. **${p.name}**: ${p.rule}`);

  lines.push("", "## Resolved conflicts", "");
  for (const c of canon.arbitration.conflicts) {
    lines.push(
      `### ${c.topic}`,
      "",
      c.resolution,
      "",
      `Rules: ${c.rules.map((r) => `\`${r}\``).join(", ")}`,
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
