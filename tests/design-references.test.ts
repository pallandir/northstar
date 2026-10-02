import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DirectionError, buildDirection } from "../mcp/src/design/direction.js";
import {
  EMPTY_INTENT,
  type Intent,
  mergeIntent,
  missingFromIntent,
} from "../mcp/src/design/intent.js";
import { type Candidate, DesignStore, type Reference } from "../mcp/src/design/store.js";
import { BrowserUnavailable, closeBrowser } from "../mcp/src/page/browser.js";
import { searchProvider } from "../mcp/src/references/harvest.js";
import { PROVIDERS, providerById } from "../mcp/src/references/providers.js";
import { intentTerms, queriesFor } from "../mcp/src/references/queries.js";
import { rankCandidates } from "../mcp/src/references/rank.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const intent: Intent = {
  ...EMPTY_INTENT,
  product: { category: "developer observability platform", surface: "landing page" },
  personality: ["technical", "precise", "premium"],
  typography: { character: "editorial technical" },
  visual: { saturation: "low", accentColors: 1 },
  avoid: ["generic saas"],
};

let root: string;
before(() => {
  root = mkdtempSync(join(tmpdir(), "northstar-design-"));
});
after(async () => {
  rmSync(root, { recursive: true, force: true });
  await closeBrowser();
});

test("an intent merges patches and names what is still missing", () => {
  assert.deepEqual(missingFromIntent(EMPTY_INTENT), [
    "product.category",
    "product.surface",
    "personality",
  ]);
  const merged = mergeIntent(undefined, { product: { category: "tool" }, personality: ["calm"] });
  assert.deepEqual(missingFromIntent(merged), ["product.surface"]);
  const next = mergeIntent(merged, { product: { surface: "docs" }, visual: { accentColors: 2 } });
  assert.equal(next.product.category, "tool");
  assert.equal(next.visual.accentColors, 2);
  assert.deepEqual(missingFromIntent(next), []);
});

test("search queries follow the intent, one per dimension", () => {
  const queries = queriesFor(intent);
  assert.deepEqual(
    queries.map((q) => q.dimension),
    ["composition", "typography", "product", "visual"],
  );
  assert.equal(
    queries[0]?.query,
    "technical precise developer observability platform landing page layout",
  );
  assert.match(
    queries[1]?.query ?? "",
    /^editorial technical developer observability platform website typography$/,
  );
  assert.match(queries[3]?.query ?? "", /^muted technical landing page design$/);
  assert.ok(intentTerms(intent).includes("premium"));
});

test("providers build search addresses without provider specific scraping", () => {
  assert.equal(
    providerById("dribbble").searchUrl("Dev Tool, landing!"),
    "https://dribbble.com/search/dev-tool-landing",
  );
  assert.equal(
    providerById("pinterest").searchUrl("dev tool"),
    "https://www.pinterest.com/search/pins/?q=dev%20tool",
  );
  assert.match(providerById("awwwards").searchUrl("a b"), /text=a%20b$/);
  assert.equal(
    providerById("pinterest").enlarge("https://i.pinimg.com/236x/a/b.jpg"),
    "https://i.pinimg.com/736x/a/b.jpg",
  );
  assert.throws(() => providerById("behance"), /Unknown reference provider/);
  assert.equal(PROVIDERS.length, 3);
});

const candidate = (
  n: number,
  provider: string,
  query: string,
  title: string,
  link = `https://x.test/${n}`,
): Candidate => ({
  id: "",
  provider,
  query,
  title,
  image: `https://img.test/${provider}/${n}.jpg`,
  link,
});

test("ranking dedupes, prefers relevant titles and mixes providers", () => {
  const pool = [
    candidate(1, "dribbble", "q1", "Pet shop checkout"),
    candidate(2, "dribbble", "q1", "Technical developer platform landing page"),
    candidate(3, "dribbble", "q1", "Technical developer platform landing page"),
    {
      ...candidate(2, "pinterest", "q1", "Same image again"),
      image: "https://img.test/dribbble/2.jpg",
    },
    candidate(4, "pinterest", "q1", "Precise premium observability dashboard"),
    candidate(5, "pinterest", "q1", "Garden"),
  ];
  const ranked = rankCandidates(pool, intentTerms(intent), 4);
  assert.equal(ranked.length, 4);
  assert.equal(new Set(ranked.map((c) => c.image)).size, 4);
  assert.deepEqual(
    new Set(ranked.slice(0, 2).map((c) => c.provider)),
    new Set(["dribbble", "pinterest"]),
  );
  assert.ok(ranked.some((c) => c.title.startsWith("Precise premium")));
});

test("links that are missing do not collapse candidates into one", () => {
  const pool = [1, 2, 3].map((n) => candidate(n, "pinterest", "q", `Shot number ${n}`, ""));
  assert.equal(rankCandidates(pool, ["shot"], 5).length, 3);
});

const reference = (id: string, patch: Partial<Reference>): Reference => ({
  id,
  source: "url",
  url: "https://x.test",
  title: `ref ${id}`,
  addedAt: "2026-01-01T00:00:00.000Z",
  image: null,
  dna: {},
  dnaSource: "recorded",
  contributes: [],
  notes: "",
  ...patch,
});

test("a direction takes each dimension from the best matching reference and never one site", () => {
  const refs = [
    reference("r1", {
      contributes: ["typography"],
      dna: { typography: { style: "serif", headlineScale: 5 }, characteristics: ["technical"] },
    }),
    reference("r2", {
      contributes: ["typography", "composition"],
      dna: {
        typography: { style: "sans" },
        composition: { structure: "asymmetric", density: 0.4 },
        characteristics: ["technical", "precise"],
      },
    }),
    reference("r3", {
      contributes: ["color"],
      dna: { color: { background: "dark", saturation: "low", accentCount: 1 } },
    }),
    reference("r4", { dna: { geometry: { radius: "high" } } }),
  ];
  const direction = buildDirection(intent, refs, new Date("2026-01-01T00:00:00Z"));
  assert.equal(direction.dna.typography?.style, "sans");
  assert.equal(direction.dna.composition?.structure, "asymmetric");
  assert.equal(direction.dna.color?.background, "dark");
  assert.equal(direction.dna.geometry, undefined);
  assert.deepEqual(direction.sources.typography, ["r1", "r2"]);
  assert.equal(direction.tokenHints.background, "dark");
  assert.match(direction.summary, /Never copy a reference/);
  assert.match(direction.summary, /Avoid: generic saas/);
});

test("a direction needs at least one contributing reference", () => {
  assert.throws(() => buildDirection(intent, [reference("r1", {})]), DirectionError);
});

test("the design store round trips intent, references, candidates and direction", () => {
  const store = new DesignStore(root);
  assert.equal(store.readIntent(), undefined);
  store.writeIntent(intent);
  assert.deepEqual(store.readIntent(), intent);
  assert.equal(store.nextReferenceId(), "r1");
  store.writeReference(reference("r1", {}), { name: "image.png", data: Buffer.from("png") });
  assert.equal(store.nextReferenceId(), "r2");
  assert.equal(store.readImage(store.readReference("r1")), undefined);
  assert.throws(() => store.readReference("r9"), /There is no reference r9/);
  store.writeCandidates([candidate(1, "dribbble", "q", "t")]);
  assert.equal(store.readCandidates().length, 1);
  const direction = buildDirection(intent, [
    reference("r1", { contributes: ["color"], dna: { color: { background: "light" } } }),
  ]);
  store.writeDirection(direction);
  assert.deepEqual(store.readDirection()?.sources, { color: ["r1"] });
});

test("search harvests a results page generically and reports a sign-in panel", async (t) => {
  const url = pathToFileURL(join(HERE, "fixtures", "pages", "gallery.html")).href;
  const provider = {
    id: "fixture",
    name: "Fixture",
    searchUrl: () => url,
    enlarge: (image: string) => image,
  };
  try {
    const outcome = await searchProvider(provider, "anything", true);
    assert.equal(outcome.failure, null);
    assert.equal(outcome.found, 3);
    assert.equal(outcome.wall, true);
    assert.equal(outcome.candidates[0]?.title, "Technical editorial developer tool landing page");
    assert.equal(outcome.candidates[0]?.link, "https://example.test/shots/1");
    assert.equal(outcome.candidates[2]?.link, "");
    assert.ok((outcome.shot?.data.length ?? 0) > 1000);
  } catch (error) {
    if (error instanceof BrowserUnavailable) return t.skip(error.message);
    throw error;
  }
});

test("a results page that cannot be opened is reported per provider, not thrown", async (t) => {
  const provider = {
    id: "gone",
    name: "Gone",
    searchUrl: () => "http://localhost:9/",
    enlarge: (i: string) => i,
  };
  try {
    const outcome = await searchProvider(provider, "x", false);
    assert.match(outcome.failure ?? "", /Could not open http:\/\/localhost:9\//);
    assert.equal(outcome.found, 0);
  } catch (error) {
    if (error instanceof BrowserUnavailable) return t.skip(error.message);
    throw error;
  }
});
