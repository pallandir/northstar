import type { Page } from "playwright-core";
import { withPage } from "./browser.js";
import { COLLECTOR } from "./collector.js";
import { refineBackgrounds } from "./refine.js";
import { type Region, regionsOf } from "./regions.js";
import type { PageSnapshot } from "./snapshot.js";
import { VIEWPORTS, type ViewportName } from "./viewports.js";

const MAX_EDGE = 1500;
const MAX_FULL_HEIGHT = 16_000;
const JPEG_QUALITY = 72;

export interface Crop {
  viewport: ViewportName;
  region: string;
  data: Buffer;
  truncated: boolean;
}

export interface Capture {
  viewport: ViewportName;
  snapshot: PageSnapshot;
  regions: Region[];
  full: Buffer;
  fullTruncated: boolean;
}

async function cropRegion(
  page: Page,
  viewport: ViewportName,
  region: Pick<Region, "name" | "box">,
): Promise<Crop> {
  const width = VIEWPORTS[viewport].width;
  const height = Math.min(Math.max(region.box.height, 1), MAX_EDGE);
  const data = await page.screenshot({
    type: "jpeg",
    quality: JPEG_QUALITY,
    fullPage: true,
    clip: { x: 0, y: Math.max(region.box.y, 0), width, height },
  });
  return { viewport, region: region.name, data, truncated: region.box.height > MAX_EDGE };
}

export async function firstView(page: Page, viewport: ViewportName): Promise<Crop> {
  const { height } = VIEWPORTS[viewport];
  return cropRegion(page, viewport, { name: "first view", box: { x: 0, y: 0, width: 0, height } });
}

export interface Analysis<R> {
  crops: string[];
  result: R;
}

export async function captureViewport<R>(
  url: string,
  viewport: ViewportName,
  analyse: (snapshot: PageSnapshot, regions: Region[]) => Analysis<R>,
): Promise<{ capture: Capture; crops: Crop[]; result: R }> {
  return withPage(url, viewport, async (page) => {
    const snapshot = (await page.evaluate(COLLECTOR)) as PageSnapshot;
    await refineBackgrounds(page, snapshot);
    const regions = regionsOf(snapshot);
    const fullHeight = Math.min(snapshot.document.height, MAX_FULL_HEIGHT);
    const full = await page.screenshot({
      type: "png",
      fullPage: true,
      clip: { x: 0, y: 0, width: VIEWPORTS[viewport].width, height: fullHeight },
    });
    const { crops: names, result } = analyse(snapshot, regions);
    const crops: Crop[] = [];
    for (const name of names) {
      if (name === "first view") crops.push(await firstView(page, viewport));
      else {
        const region = regions.find((r) => r.name === name);
        if (region) crops.push(await cropRegion(page, viewport, region));
      }
    }
    return {
      capture: {
        viewport,
        snapshot,
        regions,
        full,
        fullTruncated: snapshot.document.height > MAX_FULL_HEIGHT,
      },
      crops,
      result,
    };
  });
}
