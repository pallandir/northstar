import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODES } from "@northstar/canon";
import { z } from "zod";
import type { PageSnapshot } from "./snapshot.js";
import { VIEWPORT_NAMES, type ViewportName } from "./viewports.js";

const KEEP_RUNS = 10;
const RUN_FILE = "run.json";

const findingSchema = z.object({
  rule: z.string(),
  confidence: z.number(),
  region: z.string(),
  evidence: z.array(z.string()),
  message: z.string(),
  severity: z.enum(["error", "warn", "info"]),
  viewports: z.array(z.enum(VIEWPORT_NAMES as [ViewportName, ...ViewportName[]])),
});

const runSchema = z.object({
  id: z.string(),
  url: z.string(),
  createdAt: z.string(),
  mode: z.enum(MODES),
  viewports: z.array(z.enum(VIEWPORT_NAMES as [ViewportName, ...ViewportName[]])),
  documents: z.record(z.object({ width: z.number(), height: z.number() })),
  truncated: z.array(z.string()),
  findings: z.array(findingSchema),
});

export type RunRecord = z.infer<typeof runSchema>;

export class RunStore {
  readonly dir: string;

  constructor(root: string) {
    this.dir = join(root, ".northstar", "design", "runs");
  }

  newId(now: Date = new Date()): string {
    return now.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  }

  pathOf(id: string, file: string): string {
    return join(this.dir, id, file);
  }

  save(
    record: RunRecord,
    files: { snapshots: Record<string, PageSnapshot>; screenshots: Record<string, Buffer> },
  ): void {
    const base = join(this.dir, record.id);
    mkdirSync(base, { recursive: true });
    for (const [viewport, snapshot] of Object.entries(files.snapshots)) {
      writeFileSync(join(base, `snapshot-${viewport}.json`), JSON.stringify(snapshot));
    }
    for (const [viewport, png] of Object.entries(files.screenshots)) {
      writeFileSync(join(base, `full-${viewport}.png`), png);
    }
    writeFileSync(join(base, RUN_FILE), `${JSON.stringify(record, null, 2)}\n`);
    this.prune();
  }

  ids(): string[] {
    try {
      return readdirSync(this.dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  latest(): RunRecord | undefined {
    const id = this.ids().at(-1);
    return id === undefined ? undefined : this.read(id);
  }

  read(id: string): RunRecord {
    const file = join(this.dir, id, RUN_FILE);
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `There is no run ${id}. Run page_audit first, or pick one of: ${this.ids().join(", ") || "none yet"}.`,
        );
      }
      throw error;
    }
    const parsed = runSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `${file} is not a valid run record (${parsed.error.issues[0]?.message}). Delete the run folder and audit again.`,
      );
    }
    return parsed.data;
  }

  snapshot(id: string, viewport: string): PageSnapshot {
    return JSON.parse(
      readFileSync(join(this.dir, id, `snapshot-${viewport}.json`), "utf8"),
    ) as PageSnapshot;
  }

  screenshot(id: string, viewport: string): Buffer {
    return readFileSync(join(this.dir, id, `full-${viewport}.png`));
  }

  private prune(): void {
    const ids = this.ids();
    for (const id of ids.slice(0, Math.max(0, ids.length - KEEP_RUNS))) {
      rmSync(join(this.dir, id), { recursive: true, force: true });
    }
  }
}
