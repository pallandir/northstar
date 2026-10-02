import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Canon, MODES, type Mode } from "@northstar/canon";
import { z } from "zod";
import { appendDecision, oneLine } from "../lib/decisions.js";
import { error, modeSchema, text } from "./util.js";

export function bandFor(canon: Canon, score: number): string {
  const bands = [...canon.rubric.bands].sort((a, b) => b.min - a.min);
  return bands.find((band) => score >= band.min)?.label ?? bands[bands.length - 1]?.label ?? "";
}

export function weightedScore(
  canon: Canon,
  mode: Mode,
  scores: Record<string, number>,
  gates: { a11yErrors?: number; unallowedErrors?: number },
): { overall: number; capped?: string } {
  const weights = canon.rubric.weights[mode] ?? {};
  let total = 0;
  for (const [dimension, weight] of Object.entries(weights))
    total += ((scores[dimension] ?? 0) * weight) / 100;
  let overall = Math.round(total * 10) / 10;
  let capped: string | undefined;
  if ((gates.a11yErrors ?? 0) > 0 && overall > 6) {
    overall = 6;
    capped = "accessibility floor";
  }
  if ((gates.unallowedErrors ?? 0) > 0 && overall > 7) {
    overall = 7;
    capped = capped ? `${capped}, detector` : "detector";
  }
  return { overall, capped };
}

export function registerCritique(server: McpServer, canon: Canon, root: string): void {
  server.registerTool(
    "critique_rubric",
    {
      description:
        "Get the critique rubric and procedure for a mode: the dimensions to score from 0 to 10, their weights, and the gates that cap the result. Score against the page's own purpose, then call record_critique.",
      inputSchema: { mode: modeSchema.optional() },
    },
    async ({ mode }) => {
      const modes = mode ? [mode] : [...MODES];
      const lines = [
        canon.rubric.purpose,
        "",
        "Procedure: screenshot at 1440 and 390 wide, run slop_scan, score each dimension from 0 to 10 with one sentence of evidence, then call record_critique.",
        "",
        "Dimensions:",
        ...Object.entries(canon.rubric.dimensions).map(
          ([key, question]) => `- ${key}: ${question}`,
        ),
        "",
      ];
      for (const m of modes) {
        const weights = Object.entries(canon.rubric.weights[m] ?? {})
          .filter(([, weight]) => weight > 0)
          .map(([key, weight]) => `${key} ${weight}`)
          .join(", ");
        lines.push(`${m} weights: ${weights}`);
      }
      lines.push(
        "",
        ...Object.entries(canon.rubric.gates).map(([key, rule]) => `Gate ${key}: ${rule}`),
      );
      lines.push("", `Bands: ${canon.rubric.bands.map((b) => `${b.min}+ ${b.label}`).join("; ")}`);
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "record_critique",
    {
      description:
        "Record a critique: scores per dimension from 0 to 10, ranked findings, and the detector counts. Computes the weighted result with the gates applied and appends an entry to design/decisions.md. Include every dimension that has weight in the mode.",
      inputSchema: {
        mode: modeSchema,
        scores: z.record(z.string(), z.number().min(0).max(10)),
        findings: z
          .array(
            z.object({
              severity: z.enum(["error", "warn", "info"]),
              text: z.string().min(1).max(300),
              rule: z.string().max(60).optional(),
            }),
          )
          .max(30),
        a11yErrors: z.number().int().min(0).optional(),
        unallowedErrors: z.number().int().min(0).optional(),
        page: z.string().max(200).optional(),
      },
    },
    async ({ mode, scores, findings, a11yErrors, unallowedErrors, page }) => {
      const weights = canon.rubric.weights[mode] ?? {};
      const required = Object.entries(weights)
        .filter(([, w]) => w > 0)
        .map(([key]) => key);
      const missing = required.filter((key) => scores[key] === undefined);
      if (missing.length) return error(`Missing scores for: ${missing.join(", ")}.`);
      const unknown = Object.keys(scores).filter((key) => !(key in canon.rubric.dimensions));
      if (unknown.length) return error(`Unknown dimensions: ${unknown.join(", ")}.`);

      const { overall, capped } = weightedScore(canon, mode, scores, {
        a11yErrors,
        unallowedErrors,
      });
      const band = bandFor(canon, overall);
      const date = new Date().toISOString().slice(0, 10);
      await appendDecision(root, `${date} Critique${page ? ` of ${oneLine(page, 120)}` : ""}`, [
        "- Stage: critique",
        `- Mode: ${mode}`,
        `- Overall: ${overall} (${band})${capped ? `, capped by the ${capped} gate` : ""}`,
        `- Scores: ${Object.entries(scores)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}`,
        findings.length ? "- Findings:" : "- Findings: none",
        ...findings.map(
          (f) =>
            `  - ${f.severity}${f.rule ? ` ${oneLine(f.rule, 60)}` : ""}: ${oneLine(f.text, 300)}`,
        ),
        "- Decided by: agent",
      ]);
      return text(
        `Recorded. Overall ${overall} (${band})${capped ? `, capped by the ${capped} gate` : ""}. Appended to design/decisions.md.`,
      );
    },
  );
}
