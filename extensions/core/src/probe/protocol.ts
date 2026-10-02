import type { ComponentInfo, RouteInfo, SourceLocation } from "../types.js";

export const PROBE_REQUEST_EVENT = "northstar:probe:request";
export const PROBE_RESPONSE_EVENT = "northstar:probe:response";
export const PROBE_NAVIGATE_EVENT = "northstar:navigate";
export const PROBE_ATTR = "data-northstar-probe-id";
export const PROBE_ANSWER_TIMEOUT_MS = 1000;

export interface ProbeResult {
  component: ComponentInfo | null;
  source: SourceLocation | null;
  route: RouteInfo | null;
  failures: string[];
}
