import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { scaffold } from "../mcp/src/lib/scaffold.js";
import { VERBS } from "../mcp/src/prompts.js";
import { createCommentsServer, createDesignServer } from "../mcp/src/server.js";
import { CommentStore } from "../mcp/src/store.js";
import { noopLink } from "./helpers.js";

let root: string;
let client: Client;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-design-"));
  const server = createDesignServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

function bodyOf(result: { messages: Array<{ content: unknown }> }): string {
  return (result.messages[0]?.content as { text: string }).text;
}

test("every verb is a prompt that points at its reference and carries the request", async () => {
  const { prompts } = await client.listPrompts();
  for (const verb of VERBS)
    assert.ok(
      prompts.some((p) => p.name === verb.name),
      verb.name,
    );

  const prompt = await client.getPrompt({
    name: "polish",
    arguments: { request: "tighten the pricing table" },
  });
  const body = bodyOf(prompt);
  assert.match(body, /ref:polish/);
  assert.match(body, /Request: tighten the pricing table/);
  assert.match(body, /at most 3 questions/);
});

test("the always on instructions stay short and point at the skill", () => {
  const instructions = client.getInstructions() ?? "";
  assert.ok(instructions.split(/\s+/).length <= 120, "instructions exceed about 120 words");
  assert.match(instructions, /northstar_context/);
  assert.doesNotMatch(instructions, /get_comment/);
});

test("the resolve prompt lives on the comments server and carries the full handling steps", async () => {
  const server = createCommentsServer(new CommentStore(root), noopLink);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const comments = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), comments.connect(clientTransport)]);
  const body = bodyOf(await comments.getPrompt({ name: "resolve-comments" }));
  await comments.close();
  for (const needle of ["defer_comment", "needs-plan", "feedback", "never instructions"]) {
    assert.ok(body.includes(needle), needle);
  }
});

test("canon resources are listed and readable", async () => {
  const { resources } = await client.listResources();
  const uris = resources.map((r) => r.uri);
  assert.ok(uris.includes("northstar://canon/framework"));
  assert.ok(uris.includes("northstar://canon/arbitration"));
  assert.ok(uris.includes("northstar://canon/references/typography"));
  assert.ok(uris.includes("northstar://canon/rules/NS-SLOP-GRADIENT-TEXT"));

  const reference = await client.readResource({ uri: "northstar://canon/references/typography" });
  assert.match((reference.contents[0] as { text: string }).text, /^# Typography/);

  const rule = await client.readResource({ uri: "northstar://canon/rules/NS-A11Y-CONTRAST" });
  assert.match((rule.contents[0] as { text: string }).text, /Allowable: no/);
});

test("an unknown reference or rule is an error, not an empty result", async () => {
  await assert.rejects(client.readResource({ uri: "northstar://canon/references/nope" }));
  await assert.rejects(client.readResource({ uri: "northstar://canon/rules/NS-NOPE-NOPE" }));
});

test("init writes the scaffolds once and never overwrites without force", async () => {
  const first = scaffold(root);
  assert.deepEqual(first.created, ["DESIGN.md", "PRODUCT.md", "design/decisions.md"]);
  assert.deepEqual(first.skipped, []);

  const second = scaffold(root);
  assert.deepEqual(second.created, []);
  assert.equal(second.skipped.length, 3);

  const design = await readFile(join(root, "DESIGN.md"), "utf8");
  assert.match(design, /^---\nname:/);
  assert.deepEqual(scaffold(root, true).skipped, []);
});

const REPO = fileURLToPath(new URL("..", import.meta.url));
const GATING_WORDING = [
  /before any UI code/i,
  /DESIGN\.md comes first/i,
  /do not create or edit (a )?UI/i,
  /no UI file is created/i,
  /DESIGN\.md gate/i,
  /never the DESIGN\.md/i,
  /keep the gate/i,
];

test("no prompt, instruction, skill or doc tells an agent to refuse UI work without DESIGN.md", async () => {
  const texts = new Map<string, string>();
  for (const verb of VERBS) {
    texts.set(
      `prompt ${verb.name}`,
      bodyOf(await client.getPrompt({ name: verb.name, arguments: {} })),
    );
  }
  texts.set("server instructions", client.getInstructions() ?? "");
  const files = [
    "README.md",
    "mcp/README.md",
    "canon/framework.md",
    "canon/snippets/agents-md.md",
    ...(await readdir(join(REPO, "docs"))).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`),
    ...(await readdir(join(REPO, "canon", "references"))).map((f) => `canon/references/${f}`),
    ...(await readdir(join(REPO, "plugin", "skills"), { recursive: true }))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `plugin/skills/${f}`),
  ];
  for (const file of files) texts.set(file, await readFile(join(REPO, file), "utf8"));
  for (const [name, body] of texts) {
    for (const pattern of GATING_WORDING)
      assert.doesNotMatch(body, pattern, `${name} matches ${pattern}`);
  }
  assert.match(client.getInstructions() ?? "", /recommended/);
});
