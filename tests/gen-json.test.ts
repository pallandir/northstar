import assert from "node:assert/strict";
import { test } from "node:test";
import { formatJson } from "../mcp/scripts/gen/json.js";

test("short primitive arrays stay inline and objects expand", () => {
  assert.equal(
    formatJson({ name: "a", keywords: ["x", "y"], nested: { n: 1 } }),
    '{\n  "name": "a",\n  "keywords": ["x", "y"],\n  "nested": {\n    "n": 1\n  }\n}\n',
  );
});

test("an array that would exceed the line width is expanded", () => {
  const long = Array.from({ length: 12 }, (_, i) => `keyword-number-${i}`);
  const out = formatJson({ keywords: long });
  assert.match(out, /"keywords": \[\n {4}"keyword-number-0",/);
});

test("empty containers print compactly", () => {
  assert.equal(formatJson({ a: [], b: {} }), '{\n  "a": [],\n  "b": {}\n}\n');
});
