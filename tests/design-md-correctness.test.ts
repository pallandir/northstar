import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCanon } from "@northstar/canon";
import {
  DesignParseError,
  exportCss,
  exportDtcg,
  normalizeDirection,
  parseColor,
  parseColorAlpha,
  parseFrontmatter,
  splitFontStack,
  validateDesign,
} from "../mcp/src/design-md/index.js";

const canon = loadCanon();
const options = { rules: canon.rules.map((r) => ({ id: r.id, allowable: r.allowable })) };

function doc(
  overrides: { colors?: string; rounded?: string; spacing?: string; heading?: string } = {},
) {
  return `---
name: Acme
colors:
${overrides.colors ?? '  surface: "#FAFAF9"\n  text: "#1C1917"\n  primary: "#1D4ED8"'}
typography:
  heading:
    fontFamily: ${overrides.heading ?? "Bricolage Grotesque"}
    fontSize: 2rem
  body:
    fontFamily: Source Sans 3
    fontSize: 1rem
rounded:
${overrides.rounded ?? "  md: 8px"}
spacing:
${overrides.spacing ?? "  unit: 4px"}
northstar:
  mode: operate
---

## Overview
x
`;
}

const colors = (md: string) =>
  JSON.parse(JSON.stringify(parseFrontmatter(md).frontmatter.colors)) as Record<string, string>;

test("parseFrontmatter tolerates a BOM and CRLF and returns the body", () => {
  const parsed = parseFrontmatter("﻿---\r\nname: A\r\n---\r\n## Overview\r\nhi");
  assert.equal(parsed.frontmatter.name, "A");
  assert.match(parsed.body, /^## Overview/);
});

test("parseFrontmatter rejects missing, invalid and non mapping frontmatter with a clear error", () => {
  assert.throws(
    () => parseFrontmatter("# nothing"),
    (e) => e instanceof DesignParseError && /no YAML frontmatter/.test(e.message),
  );
  assert.throws(() => parseFrontmatter("---\n: : bad\n---"), /not valid YAML/);
  assert.throws(() => parseFrontmatter("---\n- a\n---"), /mapping/);
});

test("role words are grouped, so substrings do not match", () => {
  const md = normalizeDirection(
    [
      "- Centered content #112233",
      "- Think tank #223344",
      "- Brand blue #334455",
      "- Error red #445566",
    ].join("\n"),
  ).markdown;
  const found = colors(md);
  assert.equal(found.primary, "#334455");
  assert.equal(found.danger, "#445566");
  assert.equal(found["centered-content"], "#112233");
  assert.equal(found["think-tank"], "#223344");
});

test("an issue number is not a colour but a hex with a letter is", () => {
  const md = normalizeDirection(
    "- See issue #123 for context\n- Primary #12ab\n- Accent #1af\n- Surface #fafaf9",
  ).markdown;
  const found = colors(md);
  assert.ok(!Object.values(found).includes("#123"));
  assert.equal(found.accent, "#1af");
});

test("frontmatter and fenced code are not used as the description or title", () => {
  const source = [
    "---",
    "name: Old",
    "---",
    "",
    "```sh",
    "# not a title",
    "echo hi",
    "```",
    "",
    "# Real",
    "",
    "A calm tool for accountants.",
  ].join("\n");
  const parsed = parseFrontmatter(normalizeDirection(source).markdown);
  assert.equal(parsed.frontmatter.description, "A calm tool for accountants.");
  assert.equal(parsed.frontmatter.name, "Real");
});

test("font stacks are split, quoted and keep only the first family as the role", () => {
  assert.deepEqual(splitFontStack('"Space Grotesk", Inter, system-ui, sans-serif'), [
    "Space Grotesk",
    "Inter",
    "system-ui",
    "sans-serif",
  ]);
  assert.deepEqual(splitFontStack("'A, B', serif"), ["A, B", "serif"]);
  const md = normalizeDirection(
    'Heading font: "Space Grotesk", sans-serif\nBody font: `Inter`',
  ).markdown;
  const fm = parseFrontmatter(md).frontmatter as {
    typography: Record<string, { fontFamily: string }>;
  };
  assert.equal(fm.typography.heading?.fontFamily, "Space Grotesk");
  assert.equal(fm.typography.body?.fontFamily, "Inter");
});

test("css export quotes each family of a stack and keeps a generic fallback", () => {
  const css = exportCss(doc({ heading: `'"Space Grotesk", Inter, sans-serif'` }));
  assert.match(css, /--font-heading: "Space Grotesk", "Inter", sans-serif;/);
  assert.match(exportCss(doc()), /--font-heading: "Bricolage Grotesque", system-ui, sans-serif;/);
});

test("a stack counts as one family in validation", () => {
  const md = doc({ heading: "Inter, system-ui, sans-serif" });
  const result = validateDesign(md, options);
  assert.ok(!result.issues.some((i) => i.rule === "NS-TYPE-FONT-COUNT"));
});

test("dimensions other than px and rem warn in validation and fail the dtcg export", () => {
  const md = doc({ spacing: "  unit: 4px\n  wide: 50%" });
  const result = validateDesign(md, options);
  const issue = result.issues.find((i) => i.path === "spacing.wide");
  assert.equal(issue?.severity, "warn");
  assert.match(issue?.message ?? "", /px or rem/);
  assert.throws(() => exportDtcg(md), /spacing\.wide.*50%.*px or rem/);
  assert.match(exportCss(md), /--space-wide: 50%;/);
});

test("css color 4 forms parse", () => {
  const near = (a: number[] | null, b: number[]) =>
    assert.ok(
      a?.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 0.02),
      JSON.stringify(a),
    );
  near(parseColor("hsl(0 100% 50%)"), [1, 0, 0]);
  near(parseColor("hsl(0deg 100% 50% / 0.5)"), [1, 0, 0]);
  near(parseColor("hsl(0, 100, 50)"), [1, 0, 0]);
  near(parseColor("hsl(0.5turn 100% 50%)"), [0, 1, 1]);
  near(parseColor("oklch(100% 0 0)"), [1, 1, 1]);
  near(parseColor("oklch(0 none none)"), [0, 0, 0]);
  near(parseColor("oklch(0.628 0.2577 29.23 / 50%)"), [1, 0, 0]);
  assert.equal(parseColor("hsl(from red h s l)"), null);
});

test("alpha is read from every colour form", () => {
  assert.equal(parseColorAlpha("#112233")?.alpha, 1);
  assert.equal(parseColorAlpha("#11223380")?.alpha, 128 / 255);
  assert.equal(parseColorAlpha("rgba(0,0,0,0.4)")?.alpha, 0.4);
  assert.equal(parseColorAlpha("rgb(0 0 0 / 40%)")?.alpha, 0.4);
  assert.equal(parseColorAlpha("hsl(0 0% 0% / 0.25)")?.alpha, 0.25);
  assert.equal(parseColorAlpha("oklch(0.5 0.1 20 / 0.1)")?.alpha, 0.1);
});

test("a translucent colour is flagged and skipped for contrast", () => {
  const md = doc({ colors: '  surface: "#FAFAF9"\n  text: "#1C191780"\n  primary: "#1D4ED8"' });
  const result = validateDesign(md, options);
  const issue = result.issues.find((i) => i.path === "colors.text");
  assert.equal(issue?.severity, "warn");
  assert.match(issue?.message ?? "", /translucent/);
  assert.ok(!result.issues.some((i) => i.rule === "NS-A11Y-CONTRAST"));
});
