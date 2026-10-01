import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCanon } from "@northstar/canon";
import {
  contrastRatio,
  exportCss,
  exportDtcg,
  exportTailwind,
  normalizeDirection,
  parseColor,
  parseDesign,
  resolveRefs,
  toHex,
  validateDesign,
} from "../src/index.js";

const canon = loadCanon();
const options = {
  rules: canon.rules.map((r) => ({ id: r.id, allowable: r.allowable })),
  defaultFamilies: (canon.rules.find((r) => r.id === "NS-TYPE-DEFAULT-DISPLAY")?.params?.families ??
    []) as string[],
};
const template = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../canon/templates/DESIGN.template.md"),
  "utf8",
);

const VALID = `---
name: Acme
description: Invoices for small teams
colors:
  surface: "#FAFAF9"
  text: "#1C1917"
  primary: "#1D4ED8"
  on-primary: "#FFFFFF"
typography:
  heading:
    fontFamily: Bricolage Grotesque
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: Source Sans 3
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
rounded:
  md: 8px
spacing:
  unit: 4px
  md: 16px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
northstar:
  mode: operate
  stack: react
---
## Overview
x
## Colors
x
## Typography
x
## Layout
x
## Elevation & Depth
x
## Shapes
x
## Components
x
## Do's and Don'ts
x
`;

function errors(source: string) {
  return validateDesign(source, options).issues.filter((i) => i.severity === "error");
}

test("contrast matches the WCAG reference values", () => {
  const black = parseColor("#000");
  const white = parseColor("#ffffff");
  assert.ok(black && white);
  assert.equal(Math.round(contrastRatio(black, white)), 21);
  const grey = parseColor("#777777");
  assert.ok(grey);
  const ratio = contrastRatio(grey, white);
  assert.ok(ratio > 4.4 && ratio < 4.6, `got ${ratio}`);
});

test("colour parsing covers hex, rgb, hsl and oklch and rejects nonsense", () => {
  assert.equal(toHex(parseColor("rgb(255 0 0)") ?? [0, 0, 0]), "#ff0000");
  assert.equal(toHex(parseColor("hsl(0 100% 50%)") ?? [0, 0, 0]), "#ff0000");
  assert.equal(toHex(parseColor("oklch(1 0 0)") ?? [0, 0, 0]), "#ffffff");
  assert.equal(toHex(parseColor("oklch(0 0 0)") ?? [1, 1, 1]), "#000000");
  assert.equal(toHex(parseColor("#abc") ?? [0, 0, 0]), "#aabbcc");
  assert.equal(parseColor("not a colour"), null);
  assert.equal(parseColor("#12"), null);
});

test("references resolve through nested tokens and unknown ones are left alone", () => {
  const fm = parseDesign(VALID).frontmatter;
  assert.equal(resolveRefs(fm, "{colors.primary}"), "#1D4ED8");
  assert.equal(resolveRefs(fm, "{spacing.unit} {spacing.md}"), "4px 16px");
  assert.equal(resolveRefs(fm, "{colors.nope}"), "{colors.nope}");
});

test("a complete design system is ready with no errors", () => {
  const result = validateDesign(VALID, options);
  assert.deepEqual(
    result.issues.filter((i) => i.severity === "error"),
    [],
  );
  assert.equal(result.placeholders, 0);
  assert.equal(result.ready, true);
});

test("the shipped template parses but is not ready, because of placeholders and the mode", () => {
  const result = validateDesign(template, options);
  assert.equal(result.ready, false);
  assert.ok(result.placeholders > 10);
  assert.ok(result.issues.some((i) => i.path === "northstar.mode" && i.severity === "error"));
});

test("structural problems are errors with a path", () => {
  assert.match(errors("no frontmatter")[0]?.message ?? "", /no YAML frontmatter/);
  assert.match(errors("---\n: : :\n---")[0]?.message ?? "", /not valid YAML/);
  const missing = errors("---\nname: X\n---\n");
  for (const key of ["colors", "typography", "rounded", "spacing"]) {
    assert.ok(
      missing.some((i) => i.path === key),
      key,
    );
  }
});

test("an unresolved reference and an invalid colour are reported", () => {
  const bad = VALID.replace("{colors.primary}", "{colors.missing}").replace(
    '"#1D4ED8"',
    '"blorple"',
  );
  const found = errors(bad).map((i) => i.message);
  assert.ok(found.some((m) => /unresolved reference \{colors\.missing\}/.test(m)));
  assert.ok(found.some((m) => /not a valid hex/.test(m)));
});

test("low contrast between a component's text and background is an accessibility error", () => {
  const bad = VALID.replace('on-primary: "#FFFFFF"', 'on-primary: "#93C5FD"');
  const found = errors(bad).filter((i) => i.rule === "NS-A11Y-CONTRAST");
  assert.ok(found.length >= 1);
  assert.match(found[0]?.message ?? "", /below 4\.5:1/);
});

test("allow entries are checked against the canon", () => {
  const withAllow = (entries: string) =>
    VALID.replace("  stack: react", `  stack: react\n  allow:\n${entries}`);
  const ok = withAllow("    - { rule: NS-SLOP-GRADIENT-TEXT, reason: wordmark }\n");
  assert.deepEqual(errors(ok), []);
  const floor = errors(withAllow("    - { rule: NS-A11Y-CONTRAST, reason: brand }\n"));
  assert.ok(floor.some((i) => /cannot be allowed/.test(i.message)));
  const unknown = errors(withAllow("    - { rule: NS-NOPE-NOPE, reason: x }\n"));
  assert.ok(unknown.some((i) => /unknown rule/.test(i.message)));
  const noReason = validateDesign(withAllow("    - { rule: NS-SLOP-GRADIENT-TEXT }\n"), options);
  assert.ok(noReason.issues.some((i) => i.severity === "warn" && /needs a reason/.test(i.message)));
});

test("a default display face and too many families produce advisory warnings", () => {
  const bad = VALID.replace("Bricolage Grotesque", "Space Grotesk");
  const warns = validateDesign(bad, options).issues.filter((i) => i.severity === "warn");
  assert.ok(warns.some((i) => i.rule === "NS-TYPE-DEFAULT-DISPLAY"));
  const three = VALID.replace(
    "rounded:",
    "  display:\n    fontFamily: Playfair Pro\n    fontSize: 3rem\nrounded:",
  );
  assert.ok(validateDesign(three, options).issues.some((i) => i.rule === "NS-TYPE-FONT-COUNT"));
});

const DIRECTION = `# Meridian Design Direction

A calm dashboard for freight dispatchers who monitor many shipments at once.

## Colour
- Primary: #0B5FFF
- Background: #F7F8FA
- Text colour — #101828
- Danger / error: #D92D20

## Type
Headings use Public Sans. Body copy is set in Source Sans 3.

Radius: 6px corners. Base spacing unit is 4px.

We use shadcn components with lucide icons inside an admin console.
`;

test("a freeform direction is normalised into a design system that validates", () => {
  const known = new Set(["public sans", "source sans 3"]);
  const { markdown, report } = normalizeDirection(DIRECTION, {
    knownFamilies: known,
    stack: "react",
  });

  assert.equal(report.extracted.name, "Meridian");
  assert.deepEqual(report.extracted.colors, ["primary", "background", "text", "danger"]);
  assert.deepEqual(report.extracted.fonts.sort(), ["body", "heading"]);
  assert.equal(report.extracted.mode, "operate");
  assert.deepEqual(report.extracted.libraries.sort(), ["components", "icons"]);
  assert.ok(report.extracted.rounded && report.extracted.spacing);

  const fm = parseDesign(markdown).frontmatter as Record<string, Record<string, unknown>>;
  assert.equal(fm.colors?.primary, "#0B5FFF");
  assert.equal((fm.typography?.heading as Record<string, unknown>).fontFamily, "Public Sans");
  assert.equal(fm.rounded?.md, "6px");
  assert.equal(fm.spacing?.unit, "4px");

  const result = validateDesign(markdown, options);
  assert.deepEqual(
    result.issues.filter((i) => i.severity === "error"),
    [],
  );
  assert.ok(
    markdown.includes("A calm dashboard for freight dispatchers"),
    "original text is preserved",
  );
});

test("gaps become placeholders, missing gates and at most three questions", () => {
  const { report, markdown } = normalizeDirection("# Bare\n\nSomething vague.\n");
  assert.ok(report.missing.includes("mode"));
  assert.ok(report.missing.some((m) => m.startsWith("colors:")));
  assert.ok(report.missing.includes("typography: heading family"));
  assert.ok(report.questions.length > 0 && report.questions.length <= 3);
  assert.ok(
    report.questions.every((q) => /Default:/.test(q)),
    "every question offers a default",
  );
  assert.equal(validateDesign(markdown, options).ready, false);
});

test("exports to css, tailwind and dtcg use the resolved token values", () => {
  const css = exportCss(VALID);
  assert.match(css, /--color-primary: #1D4ED8;/);
  assert.match(css, /--font-heading: "Bricolage Grotesque", system-ui, sans-serif;/);
  assert.match(css, /--radius-md: 8px;/);

  const tailwind = exportTailwind(VALID);
  assert.match(tailwind, /^@import "tailwindcss";/);
  assert.match(tailwind, /@theme \{/);
  assert.match(tailwind, /--spacing: 4px;/);
  assert.match(tailwind, /--color-on-primary: #FFFFFF;/);

  const dtcg = JSON.parse(exportDtcg(VALID));
  assert.equal(dtcg.color.primary.$type, "color");
  assert.equal(dtcg.color.primary.$value.colorSpace, "srgb");
  assert.equal(dtcg.color.primary.$value.hex, "#1d4ed8");
  assert.deepEqual(dtcg.radius.md.$value, { value: 8, unit: "px" });
  assert.equal(dtcg.fontFamily.body.$value, "Source Sans 3");
});
