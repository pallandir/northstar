import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCanon } from "@northstar/canon";
import { defaultConfig, scanText } from "../src/index.js";

const canon = loadCanon();
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (name: string) => readFileSync(join(fixtures, name), "utf8");
const scan = (file: string, text: string, mode: "operate" | "persuade" = "operate") =>
  scanText(file, text, { ...defaultConfig(), mode }, canon);

const NEW_RULES = [
  "NS-LAYOUT-VIEWPORT-HEIGHT",
  "NS-FINISH-FLAT-SHADOW",
  "NS-FINISH-PRESS-STATE",
  "NS-FINISH-HOVER-GATE",
  "NS-FINISH-TABULAR-NUMS",
  "NS-FINISH-TEXT-WRAP",
  "NS-FINISH-Z-INDEX",
  "NS-FINISH-SATURATED-BORDER",
  "NS-MOTION-EASE-IN",
  "NS-MOTION-SCALE-ZERO",
  "NS-MOTION-DURATION",
];

test("the finished fixture raises none of the finish or motion rules", () => {
  const found = scan("finished.css", read("finished.css")).map((f) => f.rule);
  assert.deepEqual(
    found.filter((id) => NEW_RULES.includes(id)),
    [],
  );
});

test("the first test pricing page is flagged for its missing finish", () => {
  const found = new Set(scan("pricing.css", read("pricing-first-test.css")).map((f) => f.rule));
  for (const id of ["NS-FINISH-PRESS-STATE", "NS-FINISH-TEXT-WRAP", "NS-LAYOUT-VIEWPORT-HEIGHT"]) {
    assert.ok(found.has(id), `expected ${id}`);
  }
});

test("the first test tokens are flagged as the Tailwind default palette and a saturated border", () => {
  const found = new Set(
    scan("tokens.css", read("pricing-first-test-tokens.css")).map((f) => f.rule),
  );
  assert.ok(found.has("NS-LOOK-DEFAULT-PALETTE"));
  assert.ok(found.has("NS-FINISH-SATURATED-BORDER"));
});

test("durations over the cap are informational in the experience mode", () => {
  const found = scanText(
    "a.css",
    ".a{transition:opacity 600ms}",
    { ...defaultConfig(), mode: "experience" },
    canon,
  );
  assert.equal(found.find((f) => f.rule === "NS-MOTION-DURATION")?.severity, "info");
});
