import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCanon } from "../canon/src/index.js";
import { diffFindings, verdictOf } from "../mcp/src/page/compare.js";
import { type PageFinding, findingKey } from "../mcp/src/page/finding.js";
import { judge } from "../mcp/src/page/judge.js";
import { LoopBudgetSpent, LoopStore, describeLoop, loopStatus } from "../mcp/src/page/loop.js";
import { repairPlan } from "../mcp/src/page/repair.js";
import { buildReport, describeReport } from "../mcp/src/page/report.js";
import type { RunRecord } from "../mcp/src/page/runs.js";

const canon = loadCanon(join(dirname(fileURLToPath(import.meta.url)), "..", "canon"));
const scratch = mkdtempSync(join(tmpdir(), "northstar-judge-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const finding = (patch: Partial<PageFinding>): PageFinding => ({
  rule: "NS-PAGE-PRIMARY-ACTIONS",
  confidence: 0.9,
  region: "hero",
  evidence: ["a", "b"],
  message: "m",
  severity: "warn",
  viewports: ["desktop"],
  ...patch,
});

const run = (id: string, findings: PageFinding[]): RunRecord => ({
  id,
  url: "http://localhost:3000/",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "persuade",
  viewports: ["desktop"],
  documents: { desktop: { width: 1440, height: 900 } },
  truncated: [],
  findings,
});

test("the judge puts objective errors in the hero first and keeps taste findings as suggestions", () => {
  const ranked = judge([
    finding({ rule: "NS-PAGE-GENERIC-HERO", confidence: 0.95 }),
    finding({ rule: "NS-A11Y-CONTRAST", severity: "error", region: "section-3", confidence: 0.95 }),
    finding({ rule: "NS-PAGE-SMALL-TEXT", region: "footer", confidence: 0.9 }),
    finding({ rule: "NS-A11Y-FOCUS-VISIBLE", severity: "error", region: "hero", confidence: 0.9 }),
  ]);
  assert.equal(ranked[0]?.rule, "NS-A11Y-FOCUS-VISIBLE");
  assert.equal(ranked[0]?.repair, "automatic");
  assert.equal(ranked.find((f) => f.rule === "NS-PAGE-GENERIC-HERO")?.repair, "suggest");
  assert.equal(ranked.find((f) => f.rule === "NS-A11Y-CONTRAST")?.repair, "automatic");
  const lowConfidence = judge([
    finding({ rule: "NS-A11Y-CONTRAST", severity: "error", confidence: 0.6 }),
  ]);
  assert.equal(lowConfidence[0]?.repair, "suggest");
});

test("the judge returns the top five of many", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    finding({ evidence: [`e${i}`], region: `section-${i}` }),
  );
  assert.equal(judge(many).length, 5);
  assert.equal(judge(many, 2).length, 2);
});

test("a repair plan comes from the canon fix and names how to validate", () => {
  const top = judge([
    finding({ rule: "NS-SLOP-NESTED-CARD", severity: "error", evidence: [".outer", ".inner"] }),
  ]);
  const [plan] = repairPlan(canon, top);
  assert.equal(plan?.issue, "NS-SLOP-NESTED-CARD");
  assert.equal(plan?.objective, "Card inside a card");
  assert.match(plan?.modifications[0] ?? "", /Remove the inner container/);
  assert.deepEqual(plan?.evidence, [".outer", ".inner"]);
  assert.match(plan?.validate.join(" ") ?? "", /page_compare/);
  assert.throws(
    () => repairPlan(canon, judge([finding({ rule: "NS-NOPE-NOPE" })])),
    /does not define/,
  );
});

test("comparing runs names what was resolved and what was introduced", () => {
  const before = run("a", [
    finding({ rule: "NS-PAGE-PRIMARY-ACTIONS" }),
    finding({ rule: "NS-PAGE-ALIGNMENT", evidence: ["x"] }),
  ]);
  const after = run("b", [
    finding({ rule: "NS-PAGE-ALIGNMENT", evidence: ["x"] }),
    finding({ rule: "NS-PAGE-GRADIENT", evidence: ["g"] }),
  ]);
  const diff = diffFindings(before, after);
  assert.deepEqual(
    diff.resolved.map((f) => f.rule),
    ["NS-PAGE-PRIMARY-ACTIONS"],
  );
  assert.deepEqual(
    diff.introduced.map((f) => f.rule),
    ["NS-PAGE-GRADIENT"],
  );
  assert.equal(diff.remaining, 1);
  assert.equal(findingKey(before.findings[0] as PageFinding), "NS-PAGE-PRIMARY-ACTIONS|a,b");
});

test("a repair that introduces a worse finding than it resolved is a regression", () => {
  const warn = finding({});
  const error = finding({ severity: "error", rule: "NS-A11Y-CONTRAST" });
  assert.equal(verdictOf([warn], []), "improved");
  assert.equal(verdictOf([], []), "unchanged");
  assert.equal(verdictOf([error], [warn]), "mixed");
  assert.equal(verdictOf([warn], [error]), "regressed");
  assert.equal(verdictOf([], [warn]), "regressed");
});

test("the audit loop stops at its budget, restarts on request and follows the page", () => {
  const store = new LoopStore(scratch);
  const url = "http://localhost:3000/";
  let loop = store.assertRoom(url, false);
  for (const id of ["r1", "r2", "r3", "r4"]) loop = store.record(loop, id);
  assert.throws(() => store.assertRoom(url, false), LoopBudgetSpent);
  assert.throws(() => store.assertRoom(url, false), /Stop auditing, call design_report/);
  assert.equal(store.assertRoom(url, true).runs.length, 0);
  assert.equal(store.assertRoom("http://localhost:3000/other", false).runs.length, 0);
  assert.equal(store.read()?.runs.length, 4);
});

test("the loop says stop on a clean page and when the budget is spent, continue otherwise", () => {
  const loop = { url: "u", runs: ["a"], maxAudits: 4 };
  assert.equal(loopStatus(loop, []), "stop");
  assert.equal(loopStatus(loop, [finding({ confidence: 0.5 })]), "stop");
  assert.equal(loopStatus(loop, [finding({ confidence: 0.95 })]), "continue");
  assert.equal(loopStatus(loop, [finding({ severity: "error", confidence: 0.7 })]), "stop");
  assert.equal(loopStatus(loop, [finding({ severity: "error", confidence: 0.8 })]), "continue");
  assert.equal(
    loopStatus({ ...loop, runs: ["a", "b", "c", "d"] }, [finding({ severity: "error" })]),
    "stop",
  );
  assert.match(describeLoop(loop, []), /Stop here and call design_report/);
  assert.match(describeLoop(loop, [finding({})]), /page_compare/);
  assert.match(
    describeLoop({ ...loop, runs: ["a", "b", "c", "d"] }, [finding({})]),
    /budget is spent/,
  );
});

test("the report gives evidence per area and READY only when no error remains", () => {
  const first = run("a", [
    finding({ rule: "NS-A11Y-CONTRAST", severity: "error" }),
    finding({ rule: "NS-PAGE-PRIMARY-ACTIONS" }),
  ]);
  const latest = run("b", [finding({ rule: "NS-PAGE-PRIMARY-ACTIONS", confidence: 0.7 })]);
  const report = buildReport({
    loop: { url: "u", runs: ["a", "b"], maxAudits: 4 },
    first,
    latest,
    direction: undefined,
    references: [],
    now: new Date("2026-01-02T00:00:00Z"),
  });
  assert.equal(report.status, "READY");
  assert.equal(report.areas.find((a) => a.name === "Accessibility")?.status, "PASS");
  assert.equal(report.areas.find((a) => a.name === "Hierarchy")?.status, "WARN");
  assert.equal(report.resolved.length, 1);
  assert.match(report.resolved[0] ?? "", /NS-A11Y-CONTRAST/);
  const text = describeReport(report);
  assert.match(text, /NORTHSTAR DESIGN REVIEW/);
  assert.match(text, /low confidence/);
  assert.match(text, /2 of 4 audits/);
  assert.doesNotMatch(text, /\/100|score/i);
  const blocked = buildReport({
    loop: { url: "u", runs: ["a"], maxAudits: 4 },
    first,
    latest: first,
    direction: undefined,
    references: [],
  });
  assert.equal(blocked.status, "NOT READY");
  const disputed = buildReport({
    loop: { url: "u", runs: ["a"], maxAudits: 4 },
    first,
    latest: run("c", [finding({ rule: "NS-A11Y-CONTRAST", severity: "error", confidence: 0.7 })]),
    direction: undefined,
    references: [],
  });
  assert.equal(disputed.status, "READY");
  assert.equal(disputed.areas.find((a) => a.name === "Accessibility")?.status, "WARN");
  assert.match(describeReport(disputed), /low confidence/);
  assert.equal(blocked.areas.find((a) => a.name === "Accessibility")?.status, "FAIL");
});
