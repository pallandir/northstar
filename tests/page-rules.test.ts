import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCanon } from "../canon/src/index.js";
import { auditSnapshot, mergeViewports } from "../mcp/src/page/audit.js";
import { BrowserUnavailable, closeBrowser } from "../mcp/src/page/browser.js";
import { captureViewport } from "../mcp/src/page/capture.js";
import type { PageFinding } from "../mcp/src/page/finding.js";
import type { ViewportName } from "../mcp/src/page/viewports.js";

const PAGES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pages");
const canon = loadCanon(join(dirname(fileURLToPath(import.meta.url)), "..", "canon"));

interface Expectation {
  detected: string[];
  absent?: string[];
  only?: boolean;
}

const EXPECTED: Record<string, Expectation> = {
  "multiple-primary": { detected: ["NS-PAGE-PRIMARY-ACTIONS"] },
  "single-primary": { detected: [], only: true },
  "generic-saas": {
    detected: [
      "NS-PAGE-GENERIC-HERO",
      "NS-PAGE-GRADIENT",
      "NS-SLOP-CARD-GRID",
      "NS-PAGE-ICON-SQUARES",
    ],
    absent: ["NS-PAGE-PRIMARY-ACTIONS", "NS-LAYOUT-RESPONSIVE"],
  },
  "nested-cards": { detected: ["NS-SLOP-NESTED-CARD"], absent: ["NS-SLOP-CARD-GRID"] },
  "mobile-overflow": { detected: ["NS-LAYOUT-RESPONSIVE"] },
  inaccessible: {
    detected: [
      "NS-A11Y-CONTRAST",
      "NS-A11Y-FOCUS-VISIBLE",
      "NS-A11Y-TARGET-SIZE",
      "NS-A11Y-SEMANTICS",
      "NS-PAGE-SMALL-TEXT",
      "NS-PAGE-HEADING-ORDER",
    ],
  },
  "editorial-clean": { detected: [], only: true },
  "dark-overlay": { detected: [], only: true },
  "painted-layer": { detected: [], only: true },
  "painted-low": { detected: ["NS-A11Y-CONTRAST"] },
};

const VIEWPORTS: ViewportName[] = ["mobile", "desktop"];
let unavailable: string | null = null;

const audits = new Map<string, Promise<PageFinding[]>>();

function audit(name: string): Promise<PageFinding[]> {
  let found = audits.get(name);
  if (!found) {
    const url = pathToFileURL(join(PAGES, `${name}.html`)).href;
    found = (async () => {
      const perViewport = await Promise.all(
        VIEWPORTS.map(async (viewport) => {
          const { result } = await captureViewport(url, viewport, (snapshot) => ({
            crops: [],
            result: auditSnapshot(snapshot, viewport, {
              canon,
              mode: "persuade",
              allowed: () => false,
            }),
          }));
          return result;
        }),
      );
      return mergeViewports(perViewport);
    })();
    audits.set(name, found);
  }
  return found;
}

before(async () => {
  try {
    await Promise.all(Object.keys(EXPECTED).map(audit));
  } catch (error) {
    if (!(error instanceof BrowserUnavailable)) throw error;
    unavailable = error.message;
  }
});

after(async () => {
  await closeBrowser();
});

test("every fixture page has an expectation", () => {
  const files = readdirSync(PAGES)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, ""))
    .filter((name) => name !== "gallery")
    .sort();
  assert.deepEqual(files, Object.keys(EXPECTED).sort());
});

for (const [name, expectation] of Object.entries(EXPECTED)) {
  test(`page audit on ${name} finds what it should and nothing it should not`, async (t) => {
    if (unavailable) return t.skip(unavailable);
    const rules = new Set((await audit(name)).map((f) => f.rule));
    for (const rule of expectation.detected)
      assert.ok(rules.has(rule), `${rule} was not found, got ${[...rules].join(", ")}`);
    for (const rule of expectation.absent ?? [])
      assert.ok(!rules.has(rule), `${rule} should not be found`);
    if (expectation.only) assert.deepEqual([...rules], [], "this page should be clean");
  });
}

test("horizontal overflow shows up on the phone viewport only", async (t) => {
  if (unavailable) return t.skip(unavailable);
  const finding = (await audit("mobile-overflow")).find((f) => f.rule === "NS-LAYOUT-RESPONSIVE");
  assert.deepEqual(finding?.viewports, ["mobile"]);
});

test("messages read correctly for a single element", async (t) => {
  if (unavailable) return t.skip(unavailable);
  const findings = await audit("inaccessible");
  const focus = findings.find((f) => f.rule === "NS-A11Y-FOCUS-VISIBLE");
  assert.match(focus?.message ?? "", /Keyboard focus shows no change on 2 controls\./);
  const contrast = findings.find((f) => f.rule === "NS-A11Y-CONTRAST");
  assert.match(contrast?.message ?? "", /Contrast fails on 1 text block, the worst is/);
});

test("contrast measured from pixels against the page styles is reported with lower confidence", async (t) => {
  if (unavailable) return t.skip(unavailable);
  const finding = (await audit("painted-low")).find((f) => f.rule === "NS-A11Y-CONTRAST");
  assert.ok(finding && finding.confidence < 0.8, `got ${finding?.confidence}`);
  assert.match(finding?.message ?? "", /read from the pixels/);
  const plain = (await audit("inaccessible")).find((f) => f.rule === "NS-A11Y-CONTRAST");
  assert.ok(plain && plain.confidence >= 0.9);
});
