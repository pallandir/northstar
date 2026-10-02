import type { Candidate } from "../design/store.js";
import { BrowserUnavailable, waitUntil, withPage } from "../page/browser.js";
import { type Crop, firstView } from "../page/capture.js";
import type { Provider } from "./providers.js";

const MAX_ITEMS = 30;
const WALL =
  /(you are signed out|sign in to (get|see|continue)|log in to (see|continue)|continue with (email|google))/i;
const IMAGE_WAIT_MS = 12_000;
const READY_SCRIPT =
  "Array.from(document.images).filter((i) => i.naturalWidth >= 200 && i.getBoundingClientRect().width >= 150).length >= 3";
const GENERIC_ALT = new Set(["pin", "image", "photo"]);

const HARVEST_SCRIPT = String.raw`(() => {
  const big = (el) => Array.from(el.querySelectorAll("img")).filter((i) => i.getBoundingClientRect().width >= 150);
  const cardLink = (img) => {
    let node = img.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      if (big(node).length > 1) return null;
      const link = node.querySelector("a[href]");
      if (link) return link;
    }
    return null;
  };
  const items = [];
  const seen = new Set();
  for (const img of document.images) {
    const rect = img.getBoundingClientRect();
    const src = img.currentSrc || img.src;
    if (!src || seen.has(src) || img.naturalWidth < 200 || rect.width < 150 || rect.height < 90) continue;
    seen.add(src);
    const anchor = img.closest("a") || cardLink(img);
    items.push({ image: src, alt: (img.alt || "").trim().slice(0, 120), link: anchor ? anchor.href : "" });
  }
  const head = document.body ? document.body.innerText.slice(0, 800) : "";
  return { title: document.title, items, head };
})()`;

interface Harvested {
  title: string;
  items: { image: string; alt: string; link: string }[];
  head: string;
}

export interface SearchOutcome {
  provider: string;
  query: string;
  found: number;
  wall: boolean;
  failure: string | null;
  shot: Crop | null;
  candidates: Omit<Candidate, "id">[];
}

export async function searchProvider(
  provider: Provider,
  query: string,
  wantShot: boolean,
): Promise<SearchOutcome> {
  const url = provider.searchUrl(query);
  const outcome: SearchOutcome = {
    provider: provider.id,
    query,
    found: 0,
    wall: false,
    failure: null,
    shot: null,
    candidates: [],
  };
  try {
    await withPage(url, "desktop", async (page) => {
      const ready = await waitUntil(page, READY_SCRIPT, IMAGE_WAIT_MS);
      const harvested = (await page.evaluate(HARVEST_SCRIPT)) as Harvested;
      outcome.wall = WALL.test(harvested.head);
      outcome.candidates = harvested.items.slice(0, MAX_ITEMS).map((item) => ({
        provider: provider.id,
        query,
        title:
          GENERIC_ALT.has(item.alt.toLowerCase()) || !item.alt
            ? `${provider.name} result for ${query}`
            : item.alt,
        image: provider.enlarge(item.image),
        link: item.link,
      }));
      outcome.found = outcome.candidates.length;
      if (wantShot) outcome.shot = await firstView(page, "desktop");
      if (!ready && outcome.found === 0) {
        outcome.failure = `${provider.name} showed no images within ${IMAGE_WAIT_MS / 1000} seconds, it may block automated browsers or need a sign in. Pass a page URL or a screenshot file to references_add instead.`;
      }
    });
  } catch (error) {
    if (error instanceof BrowserUnavailable) throw error;
    outcome.failure = (error as Error).message;
  }
  return outcome;
}
