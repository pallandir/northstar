import { type Box, type PageNode, type PageSnapshot, bottomOf } from "./snapshot.js";

export interface Region {
  name: string;
  box: Box;
}

const HERO_REACH = 0.85;

function nameFor(tag: string, index: number, box: Box, viewportHeight: number): string {
  if (tag === "nav" || (tag === "header" && box.y < viewportHeight / 2 && box.height < 160)) {
    return "nav";
  }
  if (tag === "footer") return "footer";
  return box.y < viewportHeight * HERO_REACH ? "hero" : `section-${index}`;
}

export function regionsOf(snapshot: PageSnapshot): Region[] {
  const regions: Region[] = [];
  let sections = 0;
  let heroTaken = false;
  for (const block of snapshot.blocks) {
    let name = nameFor(block.tag, sections + 1, block.box, snapshot.viewport.height);
    if (name === "hero") {
      if (heroTaken) name = `section-${sections + 1}`;
      heroTaken = true;
    }
    if (name.startsWith("section-")) sections += 1;
    regions.push({ name, box: block.box });
  }
  if (regions.length === 0) {
    regions.push({
      name: "page",
      box: { x: 0, y: 0, width: snapshot.document.width, height: snapshot.document.height },
    });
  }
  return regions;
}

export function regionNameOf(regions: readonly Region[], node: PageNode): string {
  const middle = node.box.y + node.box.height / 2;
  const found = regions.find((r) => middle >= r.box.y && middle < bottomOf(r.box));
  return found?.name ?? regions[regions.length - 1]?.name ?? "page";
}
