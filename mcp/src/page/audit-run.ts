import type { Canon, Mode } from "@northstar/canon";
import type { Dna } from "../design/dna.js";
import { type AuditPolicy, auditSnapshot, mergeViewports } from "./audit.js";
import { captureViewport } from "./capture.js";
import type { Crop } from "./capture.js";
import type { PageFinding } from "./finding.js";
import { type RunRecord, RunStore } from "./runs.js";
import type { PageSnapshot } from "./snapshot.js";
import type { ViewportName } from "./viewports.js";

export interface AuditRequest {
  url: string;
  viewports: ViewportName[];
  root: string;
  canon: Canon;
  mode: Mode;
  allowed: AuditPolicy["allowed"];
  direction?: Dna;
  crops: (findings: PageFinding[], viewport: ViewportName) => string[];
}

export interface AuditResult {
  record: RunRecord;
  crops: Crop[];
}

export async function auditPage(request: AuditRequest): Promise<AuditResult> {
  const store = new RunStore(request.root);
  const policy: AuditPolicy = {
    canon: request.canon,
    mode: request.mode,
    allowed: request.allowed,
  };
  const snapshots: Record<string, PageSnapshot> = {};
  const screenshots: Record<string, Buffer> = {};
  const documents: RunRecord["documents"] = {};
  const truncated: string[] = [];
  const perViewport: PageFinding[][] = [];
  const crops: Crop[] = [];
  for (const viewport of request.viewports) {
    const {
      capture,
      crops: shots,
      result: findings,
    } = await captureViewport(request.url, viewport, (snapshot) => {
      const found = auditSnapshot(snapshot, viewport, policy);
      return { crops: request.crops(found, viewport), result: found };
    });
    snapshots[viewport] = capture.snapshot;
    screenshots[viewport] = capture.full;
    documents[viewport] = capture.snapshot.document;
    if (capture.fullTruncated) truncated.push(viewport);
    perViewport.push(findings);
    crops.push(...shots);
  }
  const record: RunRecord = {
    id: store.newId(),
    url: request.url,
    createdAt: new Date().toISOString(),
    mode: request.mode,
    viewports: request.viewports,
    documents,
    truncated,
    findings: mergeViewports(perViewport),
  };
  store.save(record, { snapshots, screenshots });
  return { record, crops };
}
