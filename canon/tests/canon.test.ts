import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCanon, severityFor, validateCanon } from "../src/index.js";

const canon = loadCanon();

test("the canon validates without problems", () => {
  assert.deepEqual(validateCanon(canon), []);
});

test("every accessibility rule is non allowable and an error", () => {
  const a11y = canon.rules.filter((rule) => rule.id.startsWith("NS-A11Y-"));
  assert.ok(a11y.length >= 5);
  for (const rule of a11y) assert.equal(rule.allowable, false, rule.id);
});

test("severity falls back to the default and honours a mode override", () => {
  const rule = canon.rules.find((r) => r.id === "NS-SLOP-GRADIENT-TEXT");
  assert.ok(rule);
  assert.equal(severityFor(rule, "operate"), "error");
  assert.equal(severityFor(rule, "experience"), "warn");
});

test("every arbitration conflict resolves to at least one existing rule", () => {
  const ids = new Set(canon.rules.map((rule) => rule.id));
  assert.ok(canon.arbitration.conflicts.length >= 8);
  for (const conflict of canon.arbitration.conflicts) {
    for (const id of conflict.rules) assert.ok(ids.has(id), `${conflict.id} -> ${id}`);
  }
});

test("shipped text never uses dashes as separators", () => {
  const sources = [
    canon.framework,
    ...canon.references.map((r) => r.body),
    ...canon.rules.flatMap((r) => [r.title, r.rationale, r.fix]),
    ...canon.arbitration.conflicts.flatMap((c) => [c.topic, c.resolution]),
  ];
  for (const text of sources) assert.doesNotMatch(text, /[–—]| - /);
});
