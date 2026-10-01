import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { scaffold } from "../src/lib/scaffold.js";
import { VERBS } from "../src/prompts.js";
import { createMcpServer } from "../src/server.js";
import { CommentStore } from "../src/store.js";

let root: string;
let client: Client;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-design-"));
  const server = createMcpServer(new CommentStore(root));
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

test("the resolve prompt carries the full handling steps", async () => {
  const body = bodyOf(await client.getPrompt({ name: "resolve-comments" }));
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

test("the stage prompts and the instructions put DESIGN.md first", async () => {
  for (const verb of VERBS) {
    const body = bodyOf(await client.getPrompt({ name: verb.name, arguments: {} }));
    assert.match(body, /DESIGN\.md comes first/, verb.name);
  }
  assert.match(client.getInstructions() ?? "", /DESIGN\.md before any UI code/);
});
