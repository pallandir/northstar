import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { PageFinding } from "./finding.js";

const MAX_AUDITS = 4;
const SIGNIFICANT_CONFIDENCE = 0.9;

const loopSchema = z.object({
  url: z.string(),
  runs: z.array(z.string()),
  maxAudits: z.number().int(),
});

export type Loop = z.infer<typeof loopSchema>;

export type LoopStatus = "continue" | "stop";

export class LoopBudgetSpent extends Error {}

export class LoopStore {
  private readonly file: string;
  private readonly dir: string;

  constructor(root: string) {
    this.dir = join(root, ".northstar", "design");
    this.file = join(this.dir, "loop.json");
  }

  read(): Loop | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const parsed = loopSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`${this.file} is not a valid loop record. Delete it to start a new loop.`);
    }
    return parsed.data;
  }

  assertRoom(url: string, restart: boolean): Loop {
    const current = this.read();
    if (!current || restart || current.url !== url) {
      return { url, runs: [], maxAudits: MAX_AUDITS };
    }
    if (current.runs.length >= current.maxAudits) {
      throw new LoopBudgetSpent(
        `The audit budget for ${url} is spent (${current.runs.length} of ${current.maxAudits}). Stop auditing, call design_report, or pass restart true to begin a new loop.`,
      );
    }
    return current;
  }

  record(loop: Loop, runId: string): Loop {
    const next: Loop = { ...loop, runs: [...loop.runs, runId] };
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }
}

export function loopStatus(loop: Loop, findings: readonly PageFinding[]): LoopStatus {
  const significant = findings.some(
    (f) =>
      f.severity === "error" || (f.severity === "warn" && f.confidence >= SIGNIFICANT_CONFIDENCE),
  );
  if (!significant) return "stop";
  return loop.runs.length >= loop.maxAudits ? "stop" : "continue";
}

export function describeLoop(loop: Loop, findings: readonly PageFinding[]): string {
  const used = `Audit ${loop.runs.length} of ${loop.maxAudits}.`;
  const clean = loopStatus(loop, findings) === "stop" && loop.runs.length < loop.maxAudits;
  if (clean) {
    return `${used} No error and no high confidence warning remains. Stop here and call design_report.`;
  }
  if (loop.runs.length >= loop.maxAudits) {
    return `${used} The budget is spent. Stop, call design_report, and list what remains as unresolved.`;
  }
  return `${used} Repair the top findings, audit again, then call page_compare with the two run ids.`;
}
