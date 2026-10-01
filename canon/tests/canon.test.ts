import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadCanon, severityFor, validateCanon } from "../src/index.js";

const canon = loadCanon();

test("the canon validates without problems", () => {
  assert.deepEqual(validateCanon(canon), []);
});

test("every accessibility rule is not allowable", () => {
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

const canonText = [
  canon.framework,
  readFileSync(join(canon.root, "skill", "SKILL.md.tmpl"), "utf8"),
  ...readdirSync(join(canon.root, "skill", "workflows")).map((name) =>
    readFileSync(join(canon.root, "skill", "workflows", name), "utf8"),
  ),
  ...canon.references.map((r) => r.body),
];

test("every rule id named in the framework, skill and references exists", () => {
  const ids = new Set(canon.rules.map((rule) => rule.id));
  for (const text of canonText) {
    const named = text.replace(/NS-[A-Z0-9]+-\*/g, "").match(/NS-[A-Z0-9]+(?:-[A-Z0-9]+)+/g) ?? [];
    for (const id of named) assert.ok(ids.has(id), `unknown rule ${id}`);
  }
});

const externalTools = new Set(["get_variable_defs", "get_design_context", "search_design_system"]);

function registeredTools(): Set<string> {
  const src = join(canon.root, "..", "mcp", "src");
  const packs = join(src, "packs");
  const files = [
    join(src, "server.ts"),
    ...readdirSync(packs)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => join(packs, name)),
  ];
  const names = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /\.register\(\s*"[a-z]+",\s*"([a-z_]+)"/g,
    )) {
      if (match[1]) names.add(match[1]);
    }
  }
  return names;
}

test("every tool named in the canon text is registered by the server", () => {
  const registered = registeredTools();
  assert.ok(registered.size >= 20);
  for (const text of canonText) {
    for (const match of text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
      const name = match[1] ?? "";
      if (externalTools.has(name)) continue;
      assert.ok(registered.has(name), `unknown tool ${name}`);
    }
  }
});

test("the Figma guide names the official install commands", () => {
  const figma = canon.references.find((r) => r.topic === "figma");
  assert.ok(figma);
  for (const needle of [
    "claude plugin install figma@claude-plugins-official",
    "codex mcp add figma",
    "/add-plugin figma",
    "https://mcp.figma.com/mcp",
  ]) {
    assert.ok(figma.body.includes(needle), needle);
  }
});

test("archetype fonts exist in the font data and avoid the training data defaults", () => {
  const fonts = JSON.parse(
    readFileSync(join(canon.root, "..", "packages", "data", "json", "fonts.json"), "utf8"),
  ) as Array<{ name: string }>;
  const known = new Set(fonts.map((f) => f.name.toLowerCase()));
  const defaults = new Set(
    (
      (canon.rules.find((r) => r.id === "NS-TYPE-DEFAULT-DISPLAY")?.params?.families ??
        []) as string[]
    ).map((f) => f.toLowerCase()),
  );
  for (const a of canon.archetypes.archetypes) {
    for (const [role, family] of Object.entries(a.fonts)) {
      assert.ok(
        known.has(family.toLowerCase()),
        `${a.id} ${role} ${family} is not in the font data`,
      );
    }
    assert.ok(!defaults.has(a.fonts.heading.toLowerCase()), `${a.id} heading is a default face`);
  }
});

test("archetype and synonym text never uses dashes as separators", () => {
  const texts = [
    ...canon.archetypes.archetypes.flatMap((a) => [a.summary, a.depth, ...a.layout, ...a.avoid]),
    ...Object.entries(canon.synonyms).flat(2),
  ];
  for (const text of texts) assert.doesNotMatch(text, /[–—]| - /);
});

test("there are at least ten archetypes and every blend part is declared", () => {
  assert.ok(canon.archetypes.archetypes.length >= 10);
  assert.deepEqual([...canon.archetypes.blend.takes].sort(), ["motion", "surface", "type"]);
});
