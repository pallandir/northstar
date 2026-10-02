import { withBlankPage } from "./browser.js";
import { findingKey } from "./finding.js";
import { regionsOf } from "./regions.js";
import type { RunRecord } from "./runs.js";
import { RunStore } from "./runs.js";
import type { ViewportName } from "./viewports.js";

const SEVERITY_RANK = { info: 1, warn: 2, error: 3 } as const;
const SHIFT_TOLERANCE = 8;
const PIXEL_THRESHOLD = 24;

const DIFF_SCRIPT = String.raw`async ({ a, b, threshold }) => {
  const load = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("an image could not be decoded"));
    img.src = src;
  });
  const [first, second] = await Promise.all([load(a), load(b)]);
  const width = Math.max(first.width, second.width);
  const height = Math.max(first.height, second.height);
  const draw = (img) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  };
  const x = draw(first);
  const y = draw(second);
  let differing = 0;
  for (let i = 0; i < x.length; i += 4) {
    if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > threshold) differing += 1;
  }
  return { differing, total: width * height, before: [first.width, first.height], after: [second.width, second.height] };
}`;

export type Verdict = "improved" | "unchanged" | "mixed" | "regressed";

interface PixelDiff {
  viewport: ViewportName;
  ratio: number;
  before: [number, number];
  after: [number, number];
}

export interface Comparison {
  before: string;
  after: string;
  verdict: Verdict;
  resolved: RunRecord["findings"];
  introduced: RunRecord["findings"];
  remaining: number;
  pixels: PixelDiff[];
  shifts: string[];
}

const dataUrl = (png: Buffer): string => `data:image/png;base64,${png.toString("base64")}`;

export function diffFindings(before: RunRecord, after: RunRecord) {
  const was = new Map(before.findings.map((f) => [findingKey(f), f]));
  const now = new Map(after.findings.map((f) => [findingKey(f), f]));
  return {
    resolved: [...was].filter(([k]) => !now.has(k)).map(([, f]) => f),
    introduced: [...now].filter(([k]) => !was.has(k)).map(([, f]) => f),
    remaining: [...now].filter(([k]) => was.has(k)).length,
  };
}

export function verdictOf(
  resolved: RunRecord["findings"],
  introduced: RunRecord["findings"],
): Verdict {
  const worst = (findings: RunRecord["findings"]) =>
    Math.max(0, ...findings.map((f) => SEVERITY_RANK[f.severity]));
  if (introduced.length > 0 && worst(introduced) > worst(resolved)) return "regressed";
  if (resolved.length === 0 && introduced.length === 0) return "unchanged";
  return introduced.length === 0 ? "improved" : "mixed";
}

export async function compareRuns(
  root: string,
  beforeId: string,
  afterId: string,
): Promise<Comparison> {
  const store = new RunStore(root);
  const before = store.read(beforeId);
  const after = store.read(afterId);
  const { resolved, introduced, remaining } = diffFindings(before, after);
  const shared = before.viewports.filter((v): v is ViewportName => after.viewports.includes(v));
  const pixels: PixelDiff[] = [];
  const shifts: string[] = [];
  await withBlankPage(async (page) => {
    for (const viewport of shared) {
      const args = {
        a: dataUrl(store.screenshot(beforeId, viewport)),
        b: dataUrl(store.screenshot(afterId, viewport)),
        threshold: PIXEL_THRESHOLD,
      };
      const result = (await page.evaluate(`(${DIFF_SCRIPT})(${JSON.stringify(args)})`)) as {
        differing: number;
        total: number;
        before: [number, number];
        after: [number, number];
      };
      pixels.push({
        viewport,
        ratio: Math.round((result.differing / result.total) * 10_000) / 10_000,
        before: result.before,
        after: result.after,
      });
    }
  });
  for (const viewport of shared) {
    const old = regionsOf(store.snapshot(beforeId, viewport));
    const next = regionsOf(store.snapshot(afterId, viewport));
    for (const region of next) {
      const was = old.find((r) => r.name === region.name);
      if (!was) {
        shifts.push(`${viewport} ${region.name}: new region`);
        continue;
      }
      const moved =
        Math.abs(was.box.y - region.box.y) + Math.abs(was.box.height - region.box.height);
      if (moved > SHIFT_TOLERANCE) {
        shifts.push(
          `${viewport} ${region.name}: moved ${region.box.y - was.box.y}px, height ${was.box.height} to ${region.box.height}`,
        );
      }
    }
    for (const region of old) {
      if (!next.some((r) => r.name === region.name))
        shifts.push(`${viewport} ${region.name}: removed`);
    }
  }
  return {
    before: beforeId,
    after: afterId,
    verdict: verdictOf(resolved, introduced),
    resolved,
    introduced,
    remaining,
    pixels,
    shifts,
  };
}

export function describeComparison(c: Comparison): string {
  const line = (f: RunRecord["findings"][number]) =>
    `  ${f.rule} ${f.severity} (${f.viewports.join("+")}, ${f.region})`;
  return [
    `Compared run ${c.before} with ${c.after}: ${c.verdict.toUpperCase()}.`,
    `Resolved ${c.resolved.length}, introduced ${c.introduced.length}, unchanged ${c.remaining}.`,
    ...(c.resolved.length ? ["Resolved:", ...c.resolved.map(line)] : []),
    ...(c.introduced.length ? ["Introduced:", ...c.introduced.map(line)] : []),
    ...c.pixels.map(
      (p) =>
        `${p.viewport}: ${(p.ratio * 100).toFixed(1)}% of pixels changed (${p.before.join("x")} to ${p.after.join("x")}).`,
    ),
    ...(c.shifts.length ? ["Layout changes:", ...c.shifts.map((s) => `  ${s}`)] : []),
    ...(c.verdict === "regressed"
      ? ["A repair must not introduce a higher severity finding. Undo or fix what was introduced."]
      : []),
  ].join("\n");
}
