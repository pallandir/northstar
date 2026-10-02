import type { Canon } from "@northstar/canon";
import { z } from "zod";
import type { JudgedFinding } from "./judge.js";

const PRESERVE = ["the copy", "the layout structure", "the brand colour and fonts in DESIGN.md"];

const repairSchema = z.object({
  issue: z.string(),
  objective: z.string(),
  automatic: z.boolean(),
  preserve: z.array(z.string()),
  modifications: z.array(z.string()),
  evidence: z.array(z.string()),
  validate: z.array(z.string()),
});

export type Repair = z.infer<typeof repairSchema>;

export function repairPlan(canon: Canon, top: readonly JudgedFinding[]): Repair[] {
  return top.map((finding) => {
    const rule = canon.rules.find((r) => r.id === finding.rule);
    if (!rule)
      throw new Error(`The finding names ${finding.rule}, which the canon does not define.`);
    return {
      issue: finding.rule,
      objective: rule.title,
      automatic: finding.repair === "automatic",
      preserve: PRESERVE,
      modifications: [rule.fix],
      evidence: finding.evidence,
      validate: [
        `page_audit again: ${finding.rule} no longer appears on ${finding.viewports.join(" and ")}`,
        "page_compare: no finding of a higher severity was introduced",
      ],
    };
  });
}
