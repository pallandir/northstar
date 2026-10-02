import type { Page } from "playwright-core";
import { ratio } from "./color.js";
import { contrastOf, requiredRatio } from "./rules/color.js";
import type { Box, PageNode, PageSnapshot, Rgba } from "./snapshot.js";

const MAX_CHECKS = 60;
const MAX_CLIP = { width: 1200, height: 400 };
const MIN_SHARE = 0.35;
const TEXT_KINDS: ReadonlySet<string> = new Set(["text", "heading", "button", "link"]);

const DOMINANT_SCRIPT = String.raw`(async (src) => {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("a clip could not be decoded"));
    img.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = data.length / 4;
  const decode = (key) => [((key >> 10) << 3) + 4, (((key >> 5) & 31) << 3) + 4, ((key & 31) << 3) + 4];
  let best = 0;
  let bestCount = 0;
  for (const [key, count] of counts) if (count > bestCount) { best = key; bestCount = count; }
  const bg = decode(best);
  let ink = null;
  let farthest = 0;
  for (const [key, count] of counts) {
    if (count / total < 0.002) continue;
    const c = decode(key);
    const distance = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
    if (distance > farthest) { farthest = distance; ink = c; }
  }
  return { colour: bg, share: bestCount / total, ink };
})`;

function overLayer(node: PageNode, layers: readonly Box[]): boolean {
  const x = node.box.x + node.box.width / 2;
  const y = node.box.y + node.box.height / 2;
  return layers.some((l) => x >= l.x && x <= l.x + l.width && y >= l.y && y <= l.y + l.height);
}

const DISPUTE_DISTANCE = 48;

function differs(a: Rgba, b: Rgba): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > DISPUTE_DISTANCE;
}

function clipOf(node: PageNode, document: PageSnapshot["document"]): Box | null {
  const x = Math.max(0, node.box.x);
  const y = Math.max(0, node.box.y);
  const width = Math.min(node.box.x + node.box.width, document.width, x + MAX_CLIP.width) - x;
  const height = Math.min(node.box.y + node.box.height, document.height, y + MAX_CLIP.height) - y;
  return width >= 1 && height >= 1 ? { x, y, width, height } : null;
}

function worthChecking(node: PageNode, layers: readonly Box[]): boolean {
  if (!TEXT_KINDS.has(node.kind) || node.text.length === 0) return false;
  return contrastOf(node) < requiredRatio(node) || overLayer(node, layers);
}

export async function refineBackgrounds(page: Page, snapshot: PageSnapshot): Promise<void> {
  const candidates = snapshot.nodes
    .filter((n) => worthChecking(n, snapshot.layers))
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
    .slice(0, MAX_CHECKS);
  if (candidates.length === 0) return;
  const decoder = await page.context().newPage();
  try {
    for (const node of candidates) {
      const clip = clipOf(node, snapshot.document);
      if (!clip) continue;
      const png = await page.screenshot({ type: "png", fullPage: true, clip });
      const source = `data:image/png;base64,${png.toString("base64")}`;
      const measured = (await decoder.evaluate(
        `(${DOMINANT_SCRIPT})(${JSON.stringify(source)})`,
      )) as {
        colour: [number, number, number];
        share: number;
        ink: [number, number, number] | null;
      };
      if (measured.share < MIN_SHARE) {
        node.style.backgroundImage = "image";
        continue;
      }
      const background: Rgba = [...measured.colour, 1];
      node.style.backgroundDisputed = differs(node.style.background, background);
      node.style.background = background;
      node.style.backgroundImage = "none";
      if (measured.ink) {
        const seen: Rgba = [...measured.ink, 1];
        if (ratio(seen, background) > ratio(node.style.color, background)) node.style.color = seen;
      }
    }
  } finally {
    await decoder.close();
  }
}
