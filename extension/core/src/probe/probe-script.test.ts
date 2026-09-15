import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROBE_ATTR,
  PROBE_NAVIGATE_EVENT,
  PROBE_REQUEST_EVENT,
  PROBE_RESPONSE_EVENT,
} from "./protocol.js";

// installProbe is injected via chrome.scripting.executeScript({ func: installProbe, world: "MAIN"
// }), which serializes only the function's own source text: it cannot import protocol.ts's
// constants, so it carries hand-copied literals instead. This test is the thing that notices if
// the two drift apart, since nothing else would.
describe("probe-script literals match protocol.ts", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "probe-script.ts"), "utf8");

  it("carries the same request event name", () => {
    expect(source).toContain(`const REQUEST_EVENT = "${PROBE_REQUEST_EVENT}"`);
  });

  it("carries the same response event name", () => {
    expect(source).toContain(`const RESPONSE_EVENT = "${PROBE_RESPONSE_EVENT}"`);
  });

  it("carries the same navigate event name", () => {
    expect(source).toContain(`const NAVIGATE_EVENT = "${PROBE_NAVIGATE_EVENT}"`);
  });

  it("carries the same probe attribute name", () => {
    expect(source).toContain(`const PROBE_ATTR = "${PROBE_ATTR}"`);
  });
});
