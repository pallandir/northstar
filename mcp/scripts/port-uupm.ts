import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanon } from "@northstar/canon";
import { parse } from "yaml";
import { parseCsv } from "../src/data/csv.js";
import { matchedPredicates } from "../src/data/predicates.js";
import type { Domain, Manifest, Mode, Row } from "../src/data/schema.js";

const mcpRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(mcpRoot, "..");
const sourceVersion = process.env.UUPM_VERSION ?? "2.5.0";
const sourceDir =
  process.env.UUPM_DIR ??
  join(
    homedir(),
    ".claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max",
    sourceVersion,
    "src/ui-ux-pro-max/data",
  );

type Record_ = Record<string, string>;

interface Spec {
  file: string;
  domain: Domain;
  name: (r: Record_) => string;
  keywords: (r: Record_) => string;
  summary: (r: Record_) => string;
  fields: Record<string, string>;
}

const MAX_FIELD = 360;

const kebab = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const SPECS: Spec[] = [
  {
    file: "styles.csv",
    domain: "styles",
    name: (r) => r["Style Category"] ?? "",
    keywords: (r) => `${r.Keywords} ${r["AI Prompt Keywords"]}`,
    summary: (r) => `${r.Type}. Best for ${r["Best For"]}`,
    fields: {
      type: "Type",
      primary: "Primary Colors",
      secondary: "Secondary Colors",
      effects: "Effects & Animation",
      bestFor: "Best For",
      avoidFor: "Do Not Use For",
      performance: "Performance",
      accessibility: "Accessibility",
      complexity: "Complexity",
      css: "CSS/Technical Keywords",
      checklist: "Implementation Checklist",
      variables: "Design System Variables",
    },
  },
  {
    file: "colors.csv",
    domain: "palettes",
    name: (r) => r["Product Type"] ?? "",
    keywords: (r) => `${r["Product Type"]} ${r.Notes}`,
    summary: (r) =>
      `Primary ${r.Primary}, accent ${r.Accent}, background ${r.Background}. ${r.Notes}`,
    fields: {
      primary: "Primary",
      onPrimary: "On Primary",
      secondary: "Secondary",
      accent: "Accent",
      background: "Background",
      foreground: "Foreground",
      card: "Card",
      muted: "Muted",
      mutedForeground: "Muted Foreground",
      border: "Border",
      destructive: "Destructive",
      ring: "Ring",
      notes: "Notes",
    },
  },
  {
    file: "typography.csv",
    domain: "typography",
    name: (r) => r["Font Pairing Name"] ?? "",
    keywords: (r) => `${r["Mood/Style Keywords"]} ${r.Category} ${r["Best For"]}`,
    summary: (r) => `${r["Heading Font"]} with ${r["Body Font"]}. ${r["Best For"]}`,
    fields: {
      heading: "Heading Font",
      body: "Body Font",
      category: "Category",
      mood: "Mood/Style Keywords",
      bestFor: "Best For",
      url: "Google Fonts URL",
      notes: "Notes",
    },
  },
  {
    file: "products.csv",
    domain: "products",
    name: (r) => r["Product Type"] ?? "",
    keywords: (r) => `${r.Keywords} ${r["Primary Style Recommendation"]}`,
    summary: (r) => `${r["Primary Style Recommendation"]}. ${r["Key Considerations"]}`,
    fields: {
      primaryStyle: "Primary Style Recommendation",
      secondaryStyles: "Secondary Styles",
      landingPattern: "Landing Page Pattern",
      dashboardStyle: "Dashboard Style (if applicable)",
      colorFocus: "Color Palette Focus",
      considerations: "Key Considerations",
    },
  },
  {
    file: "ui-reasoning.csv",
    domain: "reasoning",
    name: (r) => r.UI_Category ?? "",
    keywords: (r) => `${r.Recommended_Pattern} ${r.Color_Mood} ${r.Typography_Mood}`,
    summary: (r) => `${r.Recommended_Pattern}. ${r.Decision_Rules}`,
    fields: {
      pattern: "Recommended_Pattern",
      stylePriority: "Style_Priority",
      colorMood: "Color_Mood",
      typographyMood: "Typography_Mood",
      effects: "Key_Effects",
      rules: "Decision_Rules",
      antiPatterns: "Anti_Patterns",
      severity: "Severity",
    },
  },
  {
    file: "ux-guidelines.csv",
    domain: "ux",
    name: (r) => r.Issue ?? "",
    keywords: (r) => `${r.Category} ${r.Issue} ${r.Platform}`,
    summary: (r) => r.Description ?? "",
    fields: {
      category: "Category",
      platform: "Platform",
      do: "Do",
      dont: "Don't",
      good: "Code Example Good",
      bad: "Code Example Bad",
      severity: "Severity",
    },
  },
  {
    file: "charts.csv",
    domain: "charts",
    name: (r) => r["Data Type"] ?? "",
    keywords: (r) => `${r.Keywords} ${r["Best Chart Type"]}`,
    summary: (r) => `${r["Best Chart Type"]}. ${r["When to Use"]}`,
    fields: {
      best: "Best Chart Type",
      secondary: "Secondary Options",
      whenToUse: "When to Use",
      whenNot: "When NOT to Use",
      colors: "Color Guidance",
      accessibility: "Accessibility Notes",
      fallback: "A11y Fallback",
      library: "Library Recommendation",
    },
  },
  {
    file: "landing.csv",
    domain: "landing",
    name: (r) => r["Pattern Name"] ?? "",
    keywords: (r) => `${r.Keywords} ${r["Pattern Name"]}`,
    summary: (r) => `${r["Section Order"]}`,
    fields: {
      sections: "Section Order",
      cta: "Primary CTA Placement",
      colorStrategy: "Color Strategy",
      effects: "Recommended Effects",
      conversion: "Conversion Optimization",
    },
  },
  {
    file: "icons.csv",
    domain: "icons",
    name: (r) => r["Icon Name"] ?? "",
    keywords: (r) => `${r.Keywords} ${r.Category}`,
    summary: (r) => `${r.Library} ${r.Category}. ${r["Best For"]}`,
    fields: {
      category: "Category",
      library: "Library",
      importCode: "Import Code",
      usage: "Usage",
      bestFor: "Best For",
      style: "Style",
    },
  },
  {
    file: "google-fonts.csv",
    domain: "fonts",
    name: (r) => r.Family ?? "",
    keywords: (r) => `${r.Keywords} ${r.Classifications}`.slice(0, 110),
    summary: (r) => r.Category ?? "",
    fields: {
      weights: "Styles",
      axes: "Variable Axes",
      rank: "Popularity Rank",
    },
  },
];

const MODE_PATTERNS: Array<[Mode, RegExp]> = [
  [
    "operate",
    /dashboard|admin|saas|enterprise|b2b|analytics|crm|productivity|internal tool|workspace|data/i,
  ],
  [
    "read",
    /blog|docs|documentation|editorial|article|news|publication|reading|magazine|wiki|knowledge/i,
  ],
  ["persuade", /landing|marketing|conversion|startup|e-?commerce|launch|pricing|waitlist|sales/i],
  [
    "experience",
    /portfolio|creative|agency|brand|gallery|experimental|immersive|studio|fashion|luxury|art\b/i,
  ],
];

function modesFor(text: string): Mode[] {
  const modes = MODE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([mode]) => mode);
  return modes.length ? modes : [];
}

function clip(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > MAX_FIELD ? `${flat.slice(0, MAX_FIELD - 1)}…` : flat;
}

interface Policy {
  action: "drop" | "caution";
  reason?: string;
  caution?: string;
}

interface Override {
  id: string;
  action: "drop" | "caution" | "keep";
  caution?: string;
}

const curation = parse(
  readFileSync(join(mcpRoot, "data", "curation", "policies.yaml"), "utf8"),
) as {
  policies: Record<string, Policy>;
  overrides: Override[];
};
const defaultFamilies = (loadCanon(join(repoRoot, "canon")).rules.find(
  (rule) => rule.id === "NS-TYPE-DEFAULT-DISPLAY",
)?.params?.families ?? []) as string[];

const counts: Record<string, number> = {};
const dropped: Record<string, number> = {};
const cautioned: Record<string, number> = {};
const undecided: string[] = [];

mkdirSync(join(mcpRoot, "data", "json"), { recursive: true });

for (const spec of SPECS) {
  const records = parseCsv(readFileSync(join(sourceDir, spec.file), "utf8"));
  const seen = new Map<string, number>();
  const rows: Row[] = [];
  dropped[spec.domain] = 0;
  cautioned[spec.domain] = 0;

  for (const record of records) {
    const name = spec.name(record).trim();
    if (!name) continue;
    const fields = Object.fromEntries(
      Object.entries(spec.fields)
        .map(([key, column]) => [key, clip(record[column] ?? "")] as const)
        .filter(([, value]) => value !== ""),
    );
    if (spec.domain === "fonts" && fields.weights) {
      const weights = [...new Set([...fields.weights.matchAll(/\d{3}/g)].map((m) => m[0]))];
      fields.weights = weights.join(",");
    }

    const base = `${spec.domain}:${kebab(name)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;

    const matched = matchedPredicates({ domain: spec.domain, name, fields }, defaultFamilies);
    const override = curation.overrides.find((entry) => entry.id === id);
    let drop = false;
    const cautions: string[] = [];
    for (const predicate of matched) {
      const policy = override
        ? ({
            action: override.action === "keep" ? "caution" : override.action,
            caution: override.caution,
          } as Policy)
        : curation.policies[predicate.id];
      if (!policy) {
        undecided.push(`${id} matches ${predicate.id} (${predicate.rule}) without a policy`);
        continue;
      }
      if (override?.action === "keep") continue;
      if (policy.action === "drop") drop = true;
      else if (policy.caution) cautions.push(`${policy.caution} (${predicate.rule})`);
    }
    if (drop) {
      dropped[spec.domain] = (dropped[spec.domain] ?? 0) + 1;
      if (process.env.VERBOSE)
        process.stderr.write(`dropped ${id} by ${matched.map((m) => m.id).join(",")}\n`);
      continue;
    }

    const summary = clip(spec.summary(record));
    const row: Row = {
      id,
      domain: spec.domain,
      name,
      keywords: clip(spec.keywords(record)),
      summary,
      modes: spec.domain === "fonts" ? [] : modesFor(`${name} ${summary} ${fields.bestFor ?? ""}`),
      fields,
    };
    if (cautions.length) {
      row.caution = [...new Set(cautions)].join(" ");
      cautioned[spec.domain] = (cautioned[spec.domain] ?? 0) + 1;
      if (process.env.VERBOSE) process.stderr.write(`caution ${id}: ${row.caution}\n`);
    }
    rows.push(row);
  }

  counts[spec.domain] = rows.length;
  writeFileSync(join(mcpRoot, "data", "json", `${spec.domain}.json`), `${JSON.stringify(rows)}\n`);
}

if (undecided.length) {
  process.stderr.write(`curation is incomplete:\n${undecided.join("\n")}\n`);
  process.exit(1);
}

const manifest: Manifest = {
  source: "ui-ux-pro-max (nextlevelbuilder, MIT)",
  sourceVersion,
  license: "MIT",
  portedOn: process.env.PORTED_ON ?? "2026-10-01",
  counts,
  dropped,
  cautioned,
};
writeFileSync(
  join(mcpRoot, "data", "json", "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ counts, dropped, cautioned })}\n`);
