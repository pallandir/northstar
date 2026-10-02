import { type Region, regionNameOf, regionsOf } from "./regions.js";
import type { PageNode, PageSnapshot, Rgba } from "./snapshot.js";
import type { ViewportName } from "./viewports.js";
import { isFilled, visualWeights } from "./weight.js";

const MOBILE_MAX_WIDTH = 600;
const PAGE_BACKGROUND: Rgba = [255, 255, 255, 1];

export interface RuleContext {
  snapshot: PageSnapshot;
  viewport: ViewportName;
  regions: Region[];
  isMobile: boolean;
  weight(node: PageNode): number;
  regionOf(node: PageNode): string;
  parentOf(node: PageNode): PageNode | undefined;
  childrenOf(node: PageNode): PageNode[];
  ancestorsOf(node: PageNode): PageNode[];
  filled(node: PageNode): boolean;
  cardLike(node: PageNode): boolean;
}

const MIN_CARD_RADIUS = 6;
const FULL_BLEED = 0.95;
const MIN_CARD_AREA = 4000;
const CARD_KINDS: ReadonlySet<string> = new Set(["surface", "text", "landmark"]);

export function createContext(snapshot: PageSnapshot, viewport: ViewportName): RuleContext {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const children = new Map<number, PageNode[]>();
  for (const node of snapshot.nodes) {
    if (node.parent === null) continue;
    const list = children.get(node.parent) ?? [];
    list.push(node);
    children.set(node.parent, list);
  }
  const regions = regionsOf(snapshot);
  const weights = visualWeights(snapshot);
  const parentOf = (node: PageNode) => (node.parent === null ? undefined : byId.get(node.parent));
  const filled = (node: PageNode) =>
    isFilled(node, parentOf(node)?.style.background ?? PAGE_BACKGROUND);
  return {
    snapshot,
    viewport,
    regions,
    isMobile: snapshot.viewport.width < MOBILE_MAX_WIDTH,
    weight: (node) => weights.get(node.id) ?? 0,
    regionOf: (node) => regionNameOf(regions, node),
    parentOf,
    childrenOf: (node) => children.get(node.id) ?? [],
    ancestorsOf(node) {
      const chain: PageNode[] = [];
      for (let up = parentOf(node); up; up = parentOf(up)) chain.push(up);
      return chain;
    },
    filled,
    cardLike: (node) =>
      CARD_KINDS.has(node.kind) &&
      !node.interactive &&
      node.box.width * node.box.height >= MIN_CARD_AREA &&
      node.style.radius >= MIN_CARD_RADIUS &&
      (node.style.shadow || node.style.border || filled(node)) &&
      node.box.width < snapshot.viewport.width * FULL_BLEED,
  };
}
