import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Canon, renderRule } from "@northstar/canon";
import { parseFrontmatter } from "@northstar/design-md";
import {
  collectFiles,
  formatInventory,
  formatText,
  inventory,
  scanPaths,
  sortFindings,
} from "@northstar/detector";
import { z } from "zod";
import { getCanon } from "../assets.js";
import { loadScanConfig, runScan } from "../detect.js";
import { resolveInside } from "../lib/paths.js";
import type { PackRegistry } from "./registry.js";
import { error, modeSchema, text } from "./util.js";

const SHOWN = 30;

const LEVERS: Array<{ name: string; match: RegExp }> = [
  { name: "type", match: /^NS-TYPE-|^NS-FINISH-(TEXT-WRAP|TABULAR)/ },
  { name: "colour", match: /^NS-COLOR-|^NS-LOOK-|^NS-FINISH-SATURATED/ },
  { name: "states", match: /^NS-FINISH-(PRESS|HOVER)|^NS-A11Y-FOCUS|^NS-LAYOUT-STATES/ },
  { name: "spacing and layout", match: /^NS-LAYOUT-|^NS-SLOP-(CARD|NESTED|HERO)/ },
  { name: "depth and shape", match: /^NS-FINISH-(FLAT|CONCENTRIC)|SHADOW|SIDE-BORDER|GLASS/ },
  { name: "motion", match: /^NS-MOTION-/ },
  { name: "copy and detail", match: /^NS-COPY-|^NS-SLOP-|^NS-FINISH-Z/ },
];

export function registerDetect(registry: PackRegistry, canon: Canon, root: string): void {
  registry.register(
    "detect",
    "slop_scan",
    {
      description:
        "Scan UI files for generic AI patterns and library first violations. Pass paths, or diff true for the files changed since the last commit. Uses the mode and allow entries from DESIGN.md. Fix every error before finishing, warnings are advice. Each finding names a rule, call explain_rule for the reasoning.",
      inputSchema: {
        paths: z.array(z.string().max(500)).max(100).optional(),
        diff: z.boolean().optional(),
        mode: modeSchema.optional(),
      },
    },
    async ({ paths, diff, mode }) => {
      try {
        const { findings, scanned, config } = runScan({ root, paths, diff, mode });
        const errors = findings.filter((f) => f.severity === "error").length;
        const header = `Scanned ${scanned} files in ${config.mode} mode: ${errors} errors, ${findings.length - errors} other findings.`;
        if (!findings.length) return text(`${header} Clean.`);
        return text(`${header}\n${formatText(sortFindings(findings), SHOWN)}`);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  registry.register(
    "detect",
    "explain_rule",
    {
      description:
        "Explain one design rule: why it exists, whether it can be allowed, and how to fix it. Use the id from a slop_scan finding, for example NS-SLOP-GRADIENT-TEXT.",
      inputSchema: { id: z.string().min(5).max(60) },
    },
    async ({ id }) => {
      const rule = canon.rules.find((r) => r.id === id.toUpperCase());
      if (!rule) return error(`Unknown rule ${id}.`);
      const related = canon.arbitration.conflicts
        .filter((c) => c.rules.includes(rule.id))
        .map((c) => `Conflict resolved: ${c.topic}. ${c.resolution}`);
      return text([renderRule(rule), ...related].join("\n"));
    },
  );

  registry.register(
    "detect",
    "ui_audit",
    {
      description:
        "Open a refine pass on existing UI. Counts the distinct colours, radii, shadows, font sizes, spacing values, z indexes and durations in the code, lists drift from DESIGN.md, runs the detector and returns the order of levers to pull (type, colour, states, spacing, depth, motion) with the number of findings behind each. Pass paths, or leave empty for the project.",
      inputSchema: { paths: z.array(z.string().max(500)).max(100).optional() },
    },
    async ({ paths }) => {
      try {
        const config = loadScanConfig(root);
        const resolved = (paths ?? []).map((path) => resolveInside(root, path));
        const collected = collectFiles(root, resolved, config);
        if (collected.errors.length) {
          return error(`Could not read some files:\n${collected.errors.join("\n")}`);
        }
        if (!collected.files.length) {
          return error("No UI files found. Pass paths to the folders that hold the UI.");
        }
        const designPath = join(root, "DESIGN.md");
        const design = existsSync(designPath)
          ? parseFrontmatter(readFileSync(designPath, "utf8")).frontmatter
          : undefined;
        const inv = inventory(collected.files, design);
        const scan = scanPaths(root, resolved, config, getCanon());
        const byRule = new Map<string, number>();
        for (const f of scan.findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
        const levers = LEVERS.map(({ name, match }) => ({
          name,
          count: [...byRule].filter(([id]) => match.test(id)).reduce((sum, [, n]) => sum + n, 0),
        })).filter((lever) => lever.count > 0);
        const top = [...byRule].sort((a, b) => b[1] - a[1]).slice(0, 8);
        const lines = [
          formatInventory(inv),
          "",
          `Detector in ${config.mode} mode: ${scan.findings.length} findings.`,
          ...top.map(([id, n]) => `- ${id} x${n}`),
          "",
          levers.length
            ? `Levers in order: ${levers.map((l, i) => `${i + 1}. ${l.name} (${l.count})`).join(", ")}. Pull one lever per change and rescan.`
            : "No detector findings, judge the rest by eye with critique_rubric.",
        ];
        return text(lines.join("\n"));
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );
}
