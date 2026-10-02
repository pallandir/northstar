import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadCanon } from "@northstar/canon";
import { parseDesign } from "../mcp/src/design-md/index.js";
import { bandFor, weightedScore } from "../mcp/src/packs/critique.js";
import { createMcpServer } from "../mcp/src/server.js";
import { CommentStore } from "../mcp/src/store.js";
import { noopLink } from "./helpers.js";

const canon = loadCanon();
let root: string;
let client: Client;

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

function text(result: CallResult): string {
  return (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
  return client.callTool({ name, arguments: args });
}

const DIRECTION = `# Meridian Design Direction

A calm dashboard for freight dispatchers.

- Primary: #0B5FFF
- Background: #F7F8FA
- Text: #101828

Headings use Public Sans. Body copy is set in Source Sans 3.
`;

const VALID = `---
name: Acme
colors:
  surface: "#FAFAF9"
  text: "#1C1917"
  primary: "#1D4ED8"
typography:
  heading: { fontFamily: Bricolage Grotesque, fontSize: 2rem }
  body: { fontFamily: Source Sans 3, fontSize: 1rem }
rounded:
  md: 8px
spacing:
  unit: 4px
northstar:
  mode: operate
---
## Overview
x
`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-system-"));
  const server = createMcpServer(new CommentStore(root), noopLink, undefined, {
    root,
    packs: "all",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("design_md_init scaffolds once and keeps existing files", async () => {
  assert.match(
    text(await call("design_md_init")),
    /created: DESIGN\.md, PRODUCT\.md, design\/decisions\.md/,
  );
  assert.match(text(await call("design_md_init")), /created: none/);
  assert.ok(existsSync(join(root, "DESIGN.md")));
});

test("design_md_validate reports a missing file, a template, and a ready system", async () => {
  assert.equal((await call("design_md_validate")).isError, true);
  await call("design_md_init");
  assert.match(text(await call("design_md_validate")), /ready: false/);
  await writeFile(join(root, "DESIGN.md"), VALID);
  assert.match(text(await call("design_md_validate")), /ready: true/);
});

test("design_md_validate refuses a path outside the project", async () => {
  const result = await call("design_md_validate", { path: "../etc/passwd" });
  assert.equal(result.isError, true);
  assert.match(text(result), /outside the project root/);
});

test("design_md_normalize drafts from text, reports gaps, and does not write by default", async () => {
  const out = text(await call("design_md_normalize", { source: DIRECTION }));
  assert.match(out, /extracted:/);
  assert.match(out, /questions:/);
  assert.match(out, /^---\nname: Meridian/m);
  assert.equal(existsSync(join(root, "DESIGN.md")), false);
});

test("design_md_normalize reads a file in the project and writes only when none exists", async () => {
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs/direction.md"), DIRECTION);
  const wrote = text(await call("design_md_normalize", { path: "docs/direction.md", write: true }));
  assert.match(wrote, /Wrote DESIGN\.md/);
  const draft = await readFile(join(root, "DESIGN.md"), "utf8");
  assert.equal((parseDesign(draft).frontmatter as { name: string }).name, "Meridian");

  await writeFile(join(root, "DESIGN.md"), "keep me");
  const again = await call("design_md_normalize", { path: "docs/direction.md", write: true });
  assert.equal(again.isError, true);
  assert.equal(await readFile(join(root, "DESIGN.md"), "utf8"), "keep me");

  const outside = await call("design_md_normalize", { path: "../etc/hosts" });
  assert.equal(outside.isError, true);
  assert.equal((await call("design_md_normalize")).isError, true);
});

test("design_md_export returns tokens in the requested format", async () => {
  await writeFile(join(root, "DESIGN.md"), VALID);
  assert.match(
    text(await call("design_md_export", { format: "css" })),
    /--color-primary: #1D4ED8;/,
  );
  assert.match(text(await call("design_md_export", { format: "tailwind" })), /@theme \{/);
  assert.equal(
    JSON.parse(text(await call("design_md_export", { format: "dtcg" }))).color.primary.$type,
    "color",
  );
});

test("design_system_propose drafts a valid system from the data without writing it", async () => {
  const out = text(
    await call("design_system_propose", { product: "fintech banking dashboard", mode: "operate" }),
  );
  assert.match(out, /^archetype: [a-z]+ \(chosen from the brief/);
  assert.match(out, /validation: ready true, errors 0/);
  const draft = out.slice(out.indexOf("---\n"));
  assert.equal(typeof (parseDesign(draft).frontmatter as { name: unknown }).name, "string");
  assert.equal(existsSync(join(root, "DESIGN.md")), false);
});

test("design_tokens_generate returns a validated draft, exports on request and never overwrites", async () => {
  const args = {
    archetype: "minimalist",
    mode: "operate",
    name: "Ledger",
    description: "Invoices for small teams.",
    format: "css",
  };
  const out = text(await call("design_tokens_generate", args));
  assert.match(out, /^archetype: minimalist/);
  assert.match(out, /validation: ready true, errors 0/);
  assert.match(out, /--shadow-md:/);
  assert.equal(existsSync(join(root, "DESIGN.md")), false);

  const written = text(await call("design_tokens_generate", { ...args, write: true }));
  assert.match(written, /Wrote DESIGN\.md/);
  const again = await call("design_tokens_generate", { ...args, write: true });
  assert.equal(again.isError, true);
  assert.match(text(again), /never overwritten/);
});

test("design_tokens_generate blends two archetypes and fails loudly on a bad request", async () => {
  const blended = text(
    await call("design_tokens_generate", {
      archetype: "minimalist",
      secondary: "soft",
      takes: ["surface"],
      mode: "operate",
      name: "Ledger",
      description: "Invoices for small teams.",
    }),
  );
  assert.match(blended, /blend: soft contributes surface/);
  const radius = /sm: (\d+)px/.exec(blended.slice(blended.indexOf("rounded:")));
  assert.equal(radius?.[1], "16");

  const base = { mode: "operate", name: "Ledger", description: "Invoices for small teams." };
  const missing = await call("design_tokens_generate", { ...base, archetype: "nope" });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /unknown archetype "nope"/);
  const noTakes = await call("design_tokens_generate", {
    ...base,
    archetype: "minimalist",
    secondary: "soft",
  });
  assert.equal(noTakes.isError, true);
  assert.match(text(noTakes), /must say what the secondary contributes/);
});

test("critique_rubric lists dimensions, weights and gates for a mode", async () => {
  const out = text(await call("critique_rubric", { mode: "operate" }));
  assert.match(out, /hierarchy/);
  assert.match(out, /operate weights: hierarchy 18/);
  assert.match(out, /Gate accessibility_floor/);
});

const FULL = {
  hierarchy: 8,
  typography: 7,
  color: 7,
  composition: 8,
  motion: 6,
  craft: 7,
  finish: 7,
  copy: 8,
  accessibility: 9,
};

test("record_critique computes the weighted result and appends to the decisions log", async () => {
  const result = await call("record_critique", {
    mode: "operate",
    scores: FULL,
    findings: [
      { severity: "warn", text: "Table header contrast is borderline", rule: "NS-A11Y-CONTRAST" },
    ],
    page: "/shipments",
  });
  assert.match(text(result), /Overall 7\.\d/);
  const log = await readFile(join(root, "design/decisions.md"), "utf8");
  assert.match(log, /^# Design decisions/);
  assert.match(log, /Critique of \/shipments/);
  assert.match(log, /warn NS-A11Y-CONTRAST: Table header contrast is borderline/);
  await call("record_critique", { mode: "operate", scores: FULL, findings: [] });
  assert.equal(
    (await readFile(join(root, "design/decisions.md"), "utf8")).match(
      /## \d{4}-\d{2}-\d{2} Critique/g,
    )?.length,
    2,
  );
});

test("record_critique validates scores and cannot forge sections in the log", async () => {
  const missing = await call("record_critique", {
    mode: "operate",
    scores: { hierarchy: 8 },
    findings: [],
  });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /Missing scores/);
  const unknown = await call("record_critique", {
    mode: "operate",
    scores: { ...FULL, vibes: 10 },
    findings: [],
  });
  assert.equal(unknown.isError, true);

  await call("record_critique", {
    mode: "operate",
    scores: FULL,
    findings: [{ severity: "info", text: "line one\n## Injected heading\nmore" }],
    page: "# fake\n## also fake",
  });
  const log = await readFile(join(root, "design/decisions.md"), "utf8");
  assert.doesNotMatch(log, /^## Injected heading/m);
  assert.doesNotMatch(log, /^## also fake/m);
});

test("gates cap the overall score and bands follow the score", () => {
  const perfect = Object.fromEntries(Object.keys(FULL).map((k) => [k, 10]));
  assert.equal(weightedScore(canon, "operate", perfect, {}).overall, 10);
  const a11y = weightedScore(canon, "operate", perfect, { a11yErrors: 2 });
  assert.equal(a11y.overall, 6);
  assert.equal(a11y.capped, "accessibility floor");
  const both = weightedScore(canon, "operate", perfect, { a11yErrors: 1, unallowedErrors: 3 });
  assert.equal(both.overall, 6);
  assert.equal(weightedScore(canon, "operate", perfect, { unallowedErrors: 1 }).overall, 7);
  assert.equal(bandFor(canon, 9.5), "Distinctive and finished");
  assert.equal(bandFor(canon, 2), "Needs rework");
});
