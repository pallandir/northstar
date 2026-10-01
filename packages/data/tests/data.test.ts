import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadCanon } from "@northstar/canon";
import { parseCsv } from "../src/csv.js";
import { defaultDataRoot, getRow, loadData, search } from "../src/index.js";
import { matchedPredicates } from "../src/predicates.js";

const data = loadData();
const defaultFamilies = (loadCanon().rules.find((r) => r.id === "NS-TYPE-DEFAULT-DISPLAY")?.params
  ?.families ?? []) as string[];

test("the csv parser handles quotes, embedded commas, newlines and a byte order mark", () => {
  const rows = parseCsv('﻿Name,Note\r\n"Smith, J","line one\nline two"\r\nplain,"say ""hi"""\r\n');
  assert.deepEqual(rows, [
    { Name: "Smith, J", Note: "line one\nline two" },
    { Name: "plain", Note: 'say "hi"' },
  ]);
});

test("every domain loads rows with unique ids", () => {
  for (const [domain, rows] of Object.entries(data.rows)) {
    assert.ok(rows.length > 20, `${domain} has ${rows.length} rows`);
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, `${domain} ids are unique`);
  }
});

test("the manifest records the MIT source and matches the loaded counts", () => {
  assert.equal(data.manifest.license, "MIT");
  for (const [domain, count] of Object.entries(data.manifest.counts)) {
    assert.equal(data.rows[domain as keyof typeof data.rows].length, count, domain);
  }
});

test("search ranks the relevant row first and honours the limit", () => {
  const results = search(data, { domain: "products", query: "fintech banking app", limit: 3 });
  assert.ok(results.length > 0 && results.length <= 3);
  assert.match(`${results[0]?.name} ${results[0]?.keywords}`, /fintech|bank/i);
});

test("an unrelated query returns nothing instead of arbitrary rows", () => {
  assert.deepEqual(search(data, { domain: "styles", query: "zzqxv plorp" }), []);
});

test("the mode filter removes rows that exclude that mode", () => {
  const all = search(data, { domain: "styles", query: "minimal clean", limit: 20 });
  const operate = search(data, {
    domain: "styles",
    query: "minimal clean",
    mode: "operate",
    limit: 20,
  });
  assert.ok(operate.every((row) => row.modes.length === 0 || row.modes.includes("operate")));
  assert.ok(operate.length <= all.length);
});

test("getRow finds a row by id", () => {
  const first = data.rows.palettes[0];
  assert.ok(first);
  assert.equal(getRow(data, "palettes", first.id)?.name, first.name);
  assert.equal(getRow(data, "palettes", "palettes:nope"), undefined);
});

test("no shipped row prescribes gradient text or emoji icons", () => {
  for (const rows of Object.values(data.rows)) {
    for (const row of rows) {
      const hits = matchedPredicates(
        { domain: row.domain, name: row.name, fields: row.fields },
        defaultFamilies,
      ).filter((p) => p.id === "gradient-text" || p.id === "emoji-icon");
      assert.deepEqual(
        hits.map((p) => p.id),
        [],
        row.id,
      );
    }
  }
});

test("every row that still matches a canon predicate carries a caution", () => {
  for (const rows of Object.values(data.rows)) {
    for (const row of rows) {
      const hits = matchedPredicates(
        { domain: row.domain, name: row.name, fields: row.fields },
        defaultFamilies,
      );
      if (hits.length)
        assert.ok(row.caution, `${row.id} matches ${hits.map((h) => h.id)} without a caution`);
    }
  }
});

test("the shipped data stays under the size budget", () => {
  const root = defaultDataRoot();
  const total = readdirSync(root).reduce((sum, name) => sum + statSync(join(root, name)).size, 0);
  assert.ok(total < 1.5 * 1024 * 1024, `data is ${total} bytes`);
});

test("loading from a root with a missing domain file fails with the file named", () => {
  const root = mkdtempSync(join(tmpdir(), "northstar-data-"));
  assert.throws(() => loadData(root), /styles\.json is missing/);
  rmSync(root, { recursive: true, force: true });
});
