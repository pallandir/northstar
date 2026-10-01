import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadCanon } from "@northstar/canon";
import {
  type Finding,
  configFromDesign,
  defaultConfig,
  formatJson,
  formatSarif,
  formatText,
  hookFeedback,
  scanPaths,
  scanText,
} from "../src/index.js";

const canon = loadCanon();
const scratch = mkdtempSync(join(tmpdir(), "northstar-detector-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const GRADIENT =
  '<h1 className="bg-gradient-to-r from-pink-500 to-orange-400 bg-clip-text text-transparent">x</h1>';

function rules(findings: Finding[]): string[] {
  return findings.map((f) => f.rule);
}

test("an inline allow comment on the same or the previous line suppresses an allowable rule", () => {
  const config = defaultConfig();
  assert.deepEqual(rules(scanText("a.tsx", GRADIENT, config, canon)), ["NS-SLOP-GRADIENT-TEXT"]);
  const previous = `{/* northstar-allow NS-SLOP-GRADIENT-TEXT: brand wordmark */}\n${GRADIENT}`;
  assert.deepEqual(scanText("a.tsx", previous, config, canon), []);
  const same = `${GRADIENT} {/* northstar-allow NS-SLOP-GRADIENT-TEXT: brand wordmark */}`;
  assert.deepEqual(scanText("a.tsx", same, config, canon), []);
});

test("an allow entry from DESIGN.md respects its scope", () => {
  const config = {
    ...defaultConfig(),
    allow: [{ rule: "NS-SLOP-GRADIENT-TEXT", scope: "src/hero/**" }],
  };
  assert.deepEqual(scanText("src/hero/Title.tsx", GRADIENT, config, canon), []);
  assert.equal(scanText("src/pricing/Title.tsx", GRADIENT, config, canon).length, 1);
});

test("an accessibility rule cannot be allowed away", () => {
  const source = '<button className="outline-none">x</button>';
  const config = { ...defaultConfig(), allow: [{ rule: "NS-A11Y-FOCUS-VISIBLE" }] };
  assert.equal(scanText("a.tsx", source, config, canon).length, 1);
  const inline = `{/* northstar-allow NS-A11Y-FOCUS-VISIBLE: x */}\n${source}`;
  assert.equal(scanText("a.tsx", inline, defaultConfig(), canon).length, 1);
});

test("severity follows the mode: scroll hijacking is allowed in experience, an error in persuade", () => {
  const source = 'import Lenis from "lenis";';
  assert.equal(
    scanText("a.tsx", source, { ...defaultConfig(), mode: "persuade" }, canon)[0]?.severity,
    "error",
  );
  assert.deepEqual(
    scanText("a.tsx", source, { ...defaultConfig(), mode: "experience" }, canon),
    [],
  );
});

test("eyebrow labels are a warning in operate and an error in persuade", () => {
  const source =
    '<p className="text-xs uppercase tracking-widest">Features</p><h2 className="text-3xl">x</h2>';
  assert.equal(
    scanText("a.tsx", source, { ...defaultConfig(), mode: "operate" }, canon)[0]?.severity,
    "warn",
  );
  assert.equal(
    scanText("a.tsx", source, { ...defaultConfig(), mode: "persuade" }, canon)[0]?.severity,
    "error",
  );
});

test("a finding carries the line number of the offending code", () => {
  const source = `<div>\n<span>ok</span>\n${GRADIENT}\n</div>`;
  assert.equal(scanText("a.tsx", source, defaultConfig(), canon)[0]?.line, 3);
});

test("unknown file types are skipped and ignore globs skip files", () => {
  assert.deepEqual(scanText("notes.md", GRADIENT, defaultConfig(), canon), []);
  const dir = mkdtempSync(join(scratch, "walk-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });
  writeFileSync(join(dir, "src/a.tsx"), GRADIENT);
  writeFileSync(join(dir, "src/legacy.tsx"), GRADIENT);
  writeFileSync(join(dir, "node_modules/pkg/b.tsx"), GRADIENT);
  const all = scanPaths(dir, ["."], defaultConfig(), canon);
  assert.equal(all.scanned, 2);
  const ignored = scanPaths(dir, ["."], { ...defaultConfig(), ignore: ["src/legacy.tsx"] }, canon);
  assert.deepEqual(
    ignored.findings.map((f) => f.file),
    ["src/a.tsx"],
  );
});

test("configFromDesign reads mode, allow entries and ignore globs, and tolerates bad input", () => {
  const source = [
    "---",
    "name: Acme",
    "colors:",
    '  primary: "#112233"',
    "northstar:",
    "  mode: operate",
    "  allow:",
    "    - { rule: NS-SLOP-GRADIENT-TEXT, reason: wordmark, scope: src/brand/** }",
    "  ignore: [legacy/**]",
    "---",
  ].join("\n");
  const config = configFromDesign(source);
  assert.equal(config.mode, "operate");
  assert.equal(config.designSystem, true);
  assert.equal(config.allow[0]?.rule, "NS-SLOP-GRADIENT-TEXT");
  assert.deepEqual(config.ignore, ["legacy/**"]);
  assert.deepEqual(configFromDesign(undefined), defaultConfig());
  assert.deepEqual(configFromDesign("no frontmatter"), defaultConfig());
  assert.deepEqual(configFromDesign("---\n: : bad\n---"), defaultConfig());
});

test("text, json and sarif outputs describe the same findings", () => {
  const findings = scanText("a.tsx", GRADIENT, defaultConfig(), canon);
  assert.match(formatText(findings), /^a\.tsx:1 NS-SLOP-GRADIENT-TEXT error /);
  assert.equal(JSON.parse(formatJson(findings))[0].rule, "NS-SLOP-GRADIENT-TEXT");
  const sarif = JSON.parse(formatSarif(findings, "2.1.0"));
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results[0].ruleId, "NS-SLOP-GRADIENT-TEXT");
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 1);
});

test("hook feedback keeps only errors and caps them", () => {
  const make = (n: number, severity: Finding["severity"]): Finding => ({
    rule: `NS-TEST-${n}`,
    severity,
    file: "a.tsx",
    line: n,
    message: "m",
    fix: "f",
  });
  const findings = [...Array.from({ length: 8 }, (_, i) => make(i + 1, "error")), make(99, "warn")];
  const out = hookFeedback(findings, 5);
  assert.equal(out.split("\n").filter((l) => l.includes("error")).length, 5);
  assert.match(out, /3 more findings not shown/);
  assert.doesNotMatch(out, /NS-TEST-99/);
  assert.equal(hookFeedback([make(1, "warn")]), "");
});

test("a scan of a typical clean file stays fast", () => {
  const big = Array.from(
    { length: 400 },
    (_, i) => `<div className="p-${i % 8} text-sm">row ${i}</div>`,
  ).join("\n");
  const start = performance.now();
  for (let i = 0; i < 20; i++) scanText("a.tsx", big, defaultConfig(), canon);
  assert.ok(performance.now() - start < 2000, "20 scans of 400 lines took over 2s");
});
