import assert from "node:assert/strict";
import { test } from "node:test";
import { quoteFamily } from "../mcp/src/design-md/fonts.js";

test("a family name is quoted with backslashes and quotes escaped", () => {
  assert.equal(quoteFamily("Inter"), '"Inter"');
  assert.equal(quoteFamily('We"ird'), '"We\\"ird"');
  assert.equal(quoteFamily("Back\\slash"), '"Back\\\\slash"');
  assert.equal(quoteFamily("serif"), "serif");
});
