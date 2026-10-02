import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCanon } from "@northstar/canon";
import { createCommentsServer, createDesignServer } from "../mcp/src/server.js";
import { CommentStore } from "../mcp/src/store.js";
import { registerCore } from "../mcp/src/tools/core.js";
import { noopLink } from "./helpers.js";

const SERVER_ENTRY = fileURLToPath(new URL("../mcp/src/cli.ts", import.meta.url));
let root: string;
let client: Client;

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

function text(result: CallResult): string {
  return (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
}

async function connect(server: McpServer): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}

function coreServer(): McpServer {
  const server = new McpServer({ name: "dummy", version: "0.0.0" });
  registerCore(server, root, loadCanon());
  return server;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-packs-"));
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("northstar_context reports a fresh project as being at the brief stage", async () => {
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { react: "19.0.0", tailwindcss: "4.0.0" } }),
  );
  await writeFile(join(root, "components.json"), "{}");
  await connect(coreServer());
  const state = JSON.parse(
    text(await client.callTool({ name: "northstar_context", arguments: {} })),
  );
  assert.equal(state.stack, "react");
  assert.equal(state.shadcn, true);
  assert.equal(state.tailwind, true);
  assert.equal(state.stage, "brief");
  assert.ok(state.missing.some((m: string) => m.startsWith("PRODUCT.md")));
  assert.equal(state.browser, "not tried yet");
  assert.equal(state.loop, null);
  assert.equal(state.packs, undefined);
});

test("northstar_context moves to compose once PRODUCT.md and a filled DESIGN.md exist", async () => {
  await writeFile(join(root, "PRODUCT.md"), "# Product");
  await mkdir(join(root, "design"), { recursive: true });
  await writeFile(
    join(root, "DESIGN.md"),
    '---\nname: Acme\ncolors:\n  primary: "#112233"\ntypography:\n  body:\n    fontFamily: Geist\n    fontSize: 16px\nrounded:\n  md: 8px\nspacing:\n  md: 16px\nnorthstar:\n  mode: operate\n---\n# Acme',
  );
  await connect(coreServer());
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
  await connect(coreServer());
  const state = JSON.parse(
    text(await client.callTool({ name: "northstar_context", arguments: {} })),
  );
  assert.equal(state.stage, "system");
  assert.equal(state.design.placeholders, 3);
  assert.equal(state.design.ready, false);
});

test("northstar_context reports the DESIGN.md gate and how to open it", async () => {
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { react: "19" } }));
  await connect(coreServer());
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
  await connect(coreServer());
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

const TOOLS = [
  "canon_find",
  "canon_read",
  "critique_rubric",
  "design_direction",
  "design_intent",
  "design_md_export",
  "design_md_init",
  "design_md_normalize",
  "design_md_validate",
  "design_report",
  "design_search",
  "design_system_propose",
  "design_tokens_generate",
  "northstar_context",
  "page_audit",
  "page_capture",
  "page_compare",
  "record_critique",
  "references_add",
  "references_record",
  "references_search",
  "resolve_font",
  "resolve_icon",
  "resolve_library",
  "slop_scan",
];

async function fullServer(): Promise<void> {
  await connect(createDesignServer(undefined, { root }));
}

test("every design tool is available from the first list, with no pack to enable", async () => {
  await fullServer();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, TOOLS);
});

test("the comments server carries only the tools that apply comments", async () => {
  await connect(createCommentsServer(new CommentStore(root), noopLink, undefined, { root }));
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "clear_resolved",
    "defer_comment",
    "get_comment",
    "list_comments",
    "list_deferred",
    "resolve_comment",
    "resolve_comments",
  ]);
  const instructions = client.getInstructions() ?? "";
  assert.match(instructions, /list_comments/);
  assert.doesNotMatch(instructions, /DESIGN\.md/);
});

test("a server started with the removed NORTHSTAR_PACKS setting stops and says how to fix it", () => {
  const started = spawnSync(
    process.execPath,
    ["--import", "tsx", SERVER_ENTRY, "serve", "comments"],
    {
      encoding: "utf8",
      input: "",
      env: { ...process.env, NORTHSTAR_PACKS: "all", NORTHSTAR_ROOT: root },
    },
  );
  assert.equal(started.status, 1);
  assert.match(started.stderr, /NORTHSTAR_PACKS was removed/);
  assert.match(started.stderr, /northstar install/);
});

test("an unknown server name is refused with the two valid ones", () => {
  const started = spawnSync(process.execPath, ["--import", "tsx", SERVER_ENTRY, "serve", "nope"], {
    encoding: "utf8",
    input: "",
  });
  assert.equal(started.status, 2);
  assert.match(started.stderr, /northstar serve design or northstar serve comments/);
});

test("design_search takes either an id or a domain with a query, never a mix", async () => {
  await fullServer();
  const both = await client.callTool({
    name: "design_search",
    arguments: { id: "styles:glassmorphism", domain: "styles", query: "x y" },
  });
  assert.equal(both.isError, true);
  assert.match(text(both), /either id, or domain with query/);
  const neither = await client.callTool({ name: "design_search", arguments: { domain: "styles" } });
  assert.equal(neither.isError, true);
  assert.match(text(neither), /Pass domain and query to search, or id/);
});
