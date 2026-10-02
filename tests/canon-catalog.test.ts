import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCatalog,
  estimateTokens,
  findInCatalog,
  loadCanon,
  readEntry,
  renderIndex,
} from "../canon/src/index.js";

const canon = loadCanon();
const entries = buildCatalog(canon);
const find = (query: string, options = {}) => findInCatalog(entries, canon, query, options);
const ids = (query: string, options = {}) => find(query, options).hits.map((h) => h.id);

test("the catalog covers references, sections, rules, archetypes and conflicts", () => {
  const kinds = new Set(entries.map((e) => e.kind));
  assert.deepEqual([...kinds].sort(), ["archetype", "conflict", "ref", "rule"]);
  assert.equal(entries.filter((e) => e.kind === "rule").length, canon.rules.length);
  assert.ok(entries.filter((e) => e.parent).length > 40);
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
});

test("an id in the query is returned first", () => {
  assert.equal(ids("what does NS-A11Y-CONTRAST say")[0], "rule:NS-A11Y-CONTRAST");
  assert.equal(ids("arch:soft")[0], "arch:soft");
});

test("plain language finds the right rule through synonyms", () => {
  assert.ok(
    ids("button has no pressed feedback").slice(0, 3).includes("rule:NS-FINISH-PRESS-STATE"),
  );
  assert.ok(ids("dark mode looks wrong").slice(0, 4).includes("rule:NS-COLOR-DARK-PARITY"));
  assert.ok(ids("transition feels slow").slice(0, 4).includes("rule:NS-MOTION-DURATION"));
});

test("typos are corrected and reported", () => {
  const result = find("typografy scale");
  assert.ok(result.corrected.some(([from]) => from === "typografy"));
  assert.ok(result.hits.length > 0);
});

test("results stay inside the token budget and the limit", () => {
  const result = find("layout spacing color motion typography", { budget: 150, limit: 12 });
  assert.ok(result.spent <= 150);
  assert.ok(result.hits.length < 12);
  assert.ok(result.skipped > 0);
});

test("no more than three hits come from one reference", () => {
  const counts = new Map<string, number>();
  for (const hit of find("motion animation transition easing duration", { limit: 12, budget: 2000 })
    .hits) {
    const parent = entries.find((e) => e.id === hit.id)?.parent ?? hit.id;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  for (const count of counts.values()) assert.ok(count <= 3);
});

test("kind and stage narrow the search", () => {
  assert.ok(ids("shadow depth", { kind: "rule" }).every((id) => id.startsWith("rule:")));
  assert.ok(ids("choose a look", { kind: "archetype" }).every((id) => id.startsWith("arch:")));
});

test("reading a topic returns an outline, and a section returns only itself", () => {
  const topic = readEntry(entries, "ref:polish");
  assert.match(topic.body, /ref:polish#/);
  const section = entries.find((e) => e.parent === "ref:polish");
  assert.ok(section);
  assert.ok(estimateTokens(readEntry(entries, section.id).body) < topic.tokens);
});

test("reading an unknown id suggests neighbours", () => {
  assert.throws(() => readEntry(entries, "ref:polish#nope"), /Did you mean/);
  assert.throws(() => readEntry(entries, "zzz"), /canon_find/);
});

test("the index lists every reference and stays small", () => {
  const index = renderIndex(canon, entries);
  for (const reference of canon.references)
    assert.match(index, new RegExp(`- ${reference.topic}:`));
  assert.ok(estimateTokens(index) < 2500, `index is ${estimateTokens(index)} tokens`);
  assert.doesNotMatch(index, /[–—]| - /);
});
