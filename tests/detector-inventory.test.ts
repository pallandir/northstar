import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInventory, inventory } from "../mcp/src/detector/index.js";

const MESSY = `
.a { color: #111; background: #ffffff; border-radius: 3px; box-shadow: 0 2px 4px rgba(0,0,0,.2); font-size: 13px; z-index: 9999; transition: opacity 600ms; }
.b { color: #112233; border-radius: 5px; box-shadow: 0 1px 1px #000; font-size: 15px; padding: 7px 13px; }
.c { color: #111111; border-radius: 3px; font-family: "Fira Sans", sans-serif; }
`;

test("the inventory counts distinct values and normalises short hex", () => {
  const inv = inventory([{ file: "a.css", text: MESSY }]);
  assert.equal(inv.files, 1);
  assert.equal(inv.categories.colors?.distinct, 5);
  assert.equal(inv.categories.radii?.distinct, 2);
  assert.equal(inv.categories.radii?.top[0]?.value, "3px");
  assert.equal(inv.categories.shadows?.distinct, 2);
  assert.equal(inv.categories.zIndexes?.distinct, 1);
  assert.equal(inv.categories.durations?.distinct, 1);
});

test("drift against DESIGN.md lists values outside the system", () => {
  const design = {
    colors: { text: "#111111", surface: "#ffffff" },
    rounded: { sm: "3px" },
    typography: { body: { fontFamily: "Geist" } },
  };
  const inv = inventory([{ file: "a.css", text: MESSY }], design);
  const text = inv.drift.join("\n");
  assert.match(text, /color #112233/);
  assert.match(text, /radius 5px/);
  assert.match(text, /font Fira Sans/);
  assert.doesNotMatch(text, /color #111111/);
});

test("a tidy file reports no verdicts and the summary reads clearly", () => {
  const tidy = ".a{color:var(--color-text);border-radius:var(--radius-md)}";
  const inv = inventory([{ file: "a.css", text: tidy }]);
  assert.deepEqual(inv.verdicts, []);
  assert.match(
    formatInventory(inventory([{ file: "a.css", text: MESSY }])),
    /Inventory of 1 files/,
  );
});

test("components with inline styles are counted too", () => {
  const inv = inventory([
    { file: "a.tsx", text: `<div style={{ borderRadius: '9px', color: '#abcdef' }} />` },
  ]);
  assert.equal(inv.categories.radii?.distinct, 1);
  assert.equal(inv.categories.colors?.distinct, 1);
});
