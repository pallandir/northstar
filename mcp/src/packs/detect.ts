import { type Canon, renderRule } from "@northstar/canon";
import { formatText, sortFindings } from "@northstar/detector";
import { z } from "zod";
import { runScan } from "../detect.js";
import type { PackRegistry } from "./registry.js";
import { error, modeSchema, text } from "./util.js";

const SHOWN = 30;

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
}
