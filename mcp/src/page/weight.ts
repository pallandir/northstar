import { ratio, saturationOf } from "./color.js";
import { type PageNode, type PageSnapshot, type Rgba, bottomOf, rightOf } from "./snapshot.js";

const WEIGHTS = {
  size: 0.2,
  contrast: 0.25,
  saturation: 0.1,
  typography: 0.15,
  position: 0.15,
  whitespace: 0.15,
} as const;

const CONTRAST_SPAN = 20;
const MAX_FONT = 48;
const GAP_FULL = 48;
const NEIGHBOUR_REACH = 300;

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export function isFilled(node: PageNode, parentBackground: Rgba): boolean {
  const own = node.style.ownBackground;
  if (own[3] < 0.5) return false;
  return ratio(own, parentBackground) >= 1.4;
}

function gapTo(node: PageNode, others: readonly PageNode[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const other of others) {
    if (other.id === node.id) continue;
    if (Math.abs(other.box.y - node.box.y) > NEIGHBOUR_REACH) continue;
    const dx = Math.max(0, other.box.x - rightOf(node.box), node.box.x - rightOf(other.box));
    const dy = Math.max(0, other.box.y - bottomOf(node.box), node.box.y - bottomOf(other.box));
    nearest = Math.min(nearest, Math.hypot(dx, dy));
  }
  return nearest;
}

export function visualWeights(snapshot: PageSnapshot): Map<number, number> {
  const { width, height } = snapshot.viewport;
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const subjects = snapshot.nodes.filter(
    (n) => n.interactive || n.kind === "heading" || n.kind === "image",
  );
  const weights = new Map<number, number>();
  for (const node of subjects) {
    const parent = node.parent === null ? undefined : byId.get(node.parent);
    const surround = parent?.style.background ?? ([255, 255, 255, 1] as Rgba);
    const filled = isFilled(node, surround);
    const ink: Rgba = filled ? node.style.ownBackground : node.style.color;
    const contrast = ratio(ink, surround);
    const area = node.box.width * node.box.height;
    const typography =
      clamp(node.style.fontSize / MAX_FONT) * 0.6 +
      clamp((node.style.fontWeight - 400) / 500) * 0.4;
    const gap = gapTo(node, subjects);
    const score =
      WEIGHTS.size * clamp(Math.sqrt(area / (width * height))) +
      WEIGHTS.contrast * clamp((contrast - 1) / CONTRAST_SPAN) +
      WEIGHTS.saturation * clamp(saturationOf(ink) * ink[3]) +
      WEIGHTS.typography * typography +
      WEIGHTS.position * clamp(1 - node.box.y / (height * 2)) +
      WEIGHTS.whitespace * clamp(gap / GAP_FULL);
    weights.set(node.id, Math.round(score * 1000) / 1000);
  }
  return weights;
}
