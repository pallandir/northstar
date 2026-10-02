import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadCanon } from "@northstar/canon";
import { z } from "zod";
import { registerCore } from "../mcp/src/packs/core.js";
import { PackRegistry, parsePacks } from "../mcp/src/packs/registry.js";
import { createMcpServer } from "../mcp/src/server.js";
import { CommentStore } from "../mcp/src/store.js";
import { noopLink } from "./helpers.js";

let root: string;
let client: Client;
let changes: number;

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

function text(result: CallResult): string {
  return (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
}

async function connect(server: McpServer): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    changes += 1;
  });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}

function dummyServer(packs: string): McpServer {
  const server = new McpServer({ name: "dummy", version: "0.0.0" });
  const registry = new PackRegistry(server, parsePacks(packs));
  registerCore(registry, root, () => ({ state: "off", error: "test server" }), loadCanon());
  registry.register(
    "research",
    "echo_design",
    { description: "Echo a word.", inputSchema: { word: z.string() } },
    async ({ word }) => ({ content: [{ type: "text" as const, text: `echo ${word}` }] }),
  );
  return server;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-packs-"));
  changes = 0;
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("only core and comments tools are visible by default", async () => {
  await connect(
    createMcpServer(new CommentStore(root), noopLink, undefined, { root, packs: "dynamic" }),
  );
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(
    names,
    [
      "canon_find",
      "canon_read",
      "clear_resolved",
      "defer_comment",
      "enable_packs",
      "get_comment",
      "list_comments",
      "list_deferred",
      "northstar_context",
      "pack_call",
      "resolve_comment",
      "resolve_comments",
    ].sort(),
  );
});

test("parsePacks keeps core and comments, understands all", () => {
  assert.deepEqual([...parsePacks(undefined)].sort(), ["comments", "core"]);
  assert.deepEqual([...parsePacks("detect, critique")].sort(), [
    "comments",
    "core",
    "critique",
    "detect",
  ]);
  assert.equal(parsePacks("all").size, 9);
});

test("enabling a pack reveals its tools and emits tools/list_changed", async () => {
  await connect(dummyServer("dynamic"));
  assert.ok(!(await client.listTools()).tools.some((t) => t.name === "echo_design"));

  const result = await client.callTool({
    name: "enable_packs",
    arguments: { packs: ["research"] },
  });
  assert.match(text(result), /echo_design\(word\)/);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(changes >= 1, "no list_changed notification");
  assert.ok((await client.listTools()).tools.some((t) => t.name === "echo_design"));

  const again = await client.callTool({ name: "enable_packs", arguments: { packs: ["research"] } });
  assert.match(text(again), /already enabled/);
});

test("pack_call reaches a disabled pack and validates the arguments", async () => {
  await connect(dummyServer("dynamic"));
  const ok = await client.callTool({
    name: "pack_call",
    arguments: { tool: "echo_design", args: { word: "hi" } },
  });
  assert.equal(text(ok), "echo hi");

  const bad = await client.callTool({
    name: "pack_call",
    arguments: { tool: "echo_design", args: { word: 3 } },
  });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /invalid arguments/);

  const unknown = await client.callTool({ name: "pack_call", arguments: { tool: "nope" } });
  assert.equal(unknown.isError, true);

  const core = await client.callTool({ name: "pack_call", arguments: { tool: "enable_packs" } });
  assert.equal(core.isError, true);
});

test("northstar_context reports a fresh project as being at the brief stage", async () => {
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { react: "19.0.0", tailwindcss: "4.0.0" } }),
  );
  await writeFile(join(root, "components.json"), "{}");
  await connect(dummyServer("dynamic"));
  const state = JSON.parse(
    text(await client.callTool({ name: "northstar_context", arguments: {} })),
  );
  assert.equal(state.stack, "react");
  assert.equal(state.shadcn, true);
  assert.equal(state.tailwind, true);
  assert.equal(state.stage, "brief");
  assert.ok(state.missing.some((m: string) => m.startsWith("PRODUCT.md")));
  const research = state.packs.find((p: { name: string }) => p.name === "research");
  assert.equal(research.enabled, false);
  assert.deepEqual(research.tools, ["echo_design"]);
});

test("northstar_context moves to compose once PRODUCT.md and a filled DESIGN.md exist", async () => {
  await writeFile(join(root, "PRODUCT.md"), "# Product");
  await mkdir(join(root, "design"), { recursive: true });
  await writeFile(
    join(root, "DESIGN.md"),
    '---\nname: Acme\ncolors:\n  primary: "#112233"\ntypography:\n  body:\n    fontFamily: Geist\n    fontSize: 16px\nrounded:\n  md: 8px\nspacing:\n  md: 16px\nnorthstar:\n  mode: operate\n---\n# Acme',
  );
  await connect(dummyServer("dynamic"));
  const state = JSON.parse(
    text(await client.callTool({ name: "northstar_context", arguments: {} })),
  );
  assert.equal(state.stage, "compose");
  assert.equal(state.design.mode, "operate");
  assert.deepEqual(state.missing, []);
});

test("template placeholders keep the project at the system stage", async () => {
  await writeFile(join(root, "PRODUCT.md"), "# Product");
  await writeFile(
    join(root, "DESIGN.md"),
    '---\nname: "<Product name>"\ncolors:\n  primary: "<hex>"\nnorthstar:\n  mode: "<operate | read>"\n---\n',
  );
  await connect(dummyServer("dynamic"));
  const state = JSON.parse(
    text(await client.callTool({ name: "northstar_context", arguments: {} })),
  );
  assert.equal(state.stage, "system");
  assert.equal(state.design.placeholders, 3);
  assert.equal(state.design.ready, false);
});

test("northstar_context reports the DESIGN.md gate and how to open it", async () => {
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { react: "19" } }));
  await connect(dummyServer("dynamic"));
  const closed = JSON.parse(
    text(await client.callTool({ name: "northstar_context", arguments: {} })),
  );
  assert.equal(closed.gate.open, false);
  assert.match(closed.gate.gap, /no DESIGN\.md/);
  assert.match(closed.gate.next, /design_md_normalize/);

  await writeFile(
    join(root, "DESIGN.md"),
    '---\nname: Acme\ncolors:\n  primary: "#112233"\ntypography:\n  body:\n    fontFamily: Geist\n    fontSize: 16px\nrounded:\n  md: 8px\nspacing:\n  md: 16px\nnorthstar:\n  mode: operate\n---\n',
  );
  const open = JSON.parse(
    text(await client.callTool({ name: "northstar_context", arguments: {} })),
  );
  assert.deepEqual(open.gate, { open: true });

  await writeFile(
    join(root, "DESIGN.md"),
    '---\nname: Acme\ncolors:\n  primary: "#112233"\nnorthstar:\n  mode: operate\n---\n',
  );
  const incomplete = JSON.parse(
    text(await client.callTool({ name: "northstar_context", arguments: {} })),
  );
  assert.equal(incomplete.gate.open, false);
  assert.match(incomplete.gate.gap, /not valid yet \(typography is required/);
});

test("northstar_context surfaces a DESIGN.md that cannot be parsed and a broken package.json", async () => {
  await writeFile(join(root, "DESIGN.md"), "no frontmatter");
  await connect(dummyServer("dynamic"));
  const state = JSON.parse(
    text(await client.callTool({ name: "northstar_context", arguments: {} })),
  );
  assert.match(state.design.error, /no YAML frontmatter/);
  assert.match(state.gate.gap, /cannot be read/);
  await writeFile(join(root, "package.json"), "{ broken");
  const broken = await client.callTool({ name: "northstar_context", arguments: {} });
  assert.equal(broken.isError, true);
  assert.match(text(broken), /package\.json is not valid JSON/);
});

test("an unknown pack name is an error naming the valid packs", () => {
  assert.throws(() => parsePacks("research,nope"), /unknown pack "nope".*critique/);
  assert.deepEqual([...parsePacks("research")].sort(), ["comments", "core", "research"]);
});
