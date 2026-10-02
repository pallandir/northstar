import type { Canon, Mode } from "@northstar/canon";
import { DesignStore } from "../design/store.js";
import { loadScanConfig } from "../detect.js";
import { compileAllow } from "../detector/suppress.js";
import { auditPage } from "./audit-run.js";
import { type Crop, captureViewport } from "./capture.js";
import { type JudgedFinding, judge } from "./judge.js";
import { type Loop, LoopStore } from "./loop.js";
import { type Repair, repairPlan } from "./repair.js";
import { type RunRecord, RunStore } from "./runs.js";
import { DEFAULT_VIEWPORTS, type ViewportName } from "./viewports.js";

const MAX_CROPS_PER_VIEWPORT = 2;
const FIRST_VIEW = "first view";

export interface AuditOutcome {
  record: RunRecord;
  top: JudgedFinding[];
  repairs: Repair[];
  crops: Crop[];
  dir: string;
  loop: Loop;
}

export async function auditProject(options: {
  root: string;
  canon: Canon;
  url: string;
  viewports?: ViewportName[];
  mode?: Mode;
  restart?: boolean;
}): Promise<AuditOutcome> {
  const loops = new LoopStore(options.root);
  const open = loops.assertRoom(options.url, options.restart ?? false);
  const config = loadScanConfig(options.root, options.mode);
  const { record, crops } = await auditPage({
    url: options.url,
    viewports: options.viewports ?? DEFAULT_VIEWPORTS,
    root: options.root,
    canon: options.canon,
    mode: config.mode,
    allowed: compileAllow(config.allow),
    direction: new DesignStore(options.root).readDirection()?.dna,
    crops: (findings, viewport) => {
      const regions = judge(findings.filter((f) => f.viewports.includes(viewport)))
        .map((f) => f.region)
        .filter((region) => region !== "page");
      return [...new Set(regions)].slice(0, MAX_CROPS_PER_VIEWPORT);
    },
  });
  const top = judge(record.findings);
  const store = new RunStore(options.root);
  const repairs = repairPlan(options.canon, top);
  store.saveRepairs(record.id, repairs);
  const loop = loops.record(open, record.id);
  return { record, top, repairs, crops, dir: store.dir, loop };
}

export async function captureProject(options: {
  url: string;
  viewports?: ViewportName[];
  regions?: string[];
}): Promise<{ crops: Crop[]; notes: string[] }> {
  const crops: Crop[] = [];
  const notes: string[] = [];
  for (const viewport of options.viewports ?? DEFAULT_VIEWPORTS) {
    const shot = await captureViewport(options.url, viewport, (_, found) => ({
      crops: options.regions?.length ? options.regions : [FIRST_VIEW],
      result: found,
    }));
    crops.push(...shot.crops);
    const { width, height } = shot.capture.snapshot.document;
    notes.push(
      `${viewport}: ${width}x${height}px, regions ${shot.result.map((r) => r.name).join(", ")}`,
    );
  }
  return { crops, notes };
}
