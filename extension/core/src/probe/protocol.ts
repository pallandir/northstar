import type { ComponentInfo, RouteInfo, SourceLocation } from "../types.js";

export type ProbeSource = SourceLocation;

// Shared with probe-script.ts, which cannot import these: chrome.scripting.executeScript
// serializes only a function's own source text, so the literals there are hand-kept copies of
// these, checked against each other by probe-script.test.ts.
export const PROBE_REQUEST_EVENT = "northstar:probe:request";
export const PROBE_RESPONSE_EVENT = "northstar:probe:response";
export const PROBE_NAVIGATE_EVENT = "northstar:navigate";
export const PROBE_ATTR = "data-northstar-probe-id";
export const PROBE_TIMEOUT_MS = 150;

export interface ProbeResult {
  component: ComponentInfo | null;
  source: ProbeSource | null;
  route: RouteInfo | null;
}
