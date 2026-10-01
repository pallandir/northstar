import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server.js";
import { CommentStore } from "../src/store.js";

let root: string;
let client: Client;

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

function text(result: CallResult): string {
  return (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
}

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  return client.callTool({ name, arguments: args });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "northstar-resolve-"));
  const server = createMcpServer(new CommentStore(root), undefined, undefined, {
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

test("design_search returns compact candidate rows and respects the limit", async () => {
  const out = text(
    await call("design_search", { domain: "products", query: "fintech banking", limit: 2 }),
  );
  const rows = out.split("\n").filter((line) => line.startsWith("- products:"));
  assert.ok(rows.length >= 1 && rows.length <= 2, out);
});

test("design_search surfaces cautions on rows the canon disagrees with", async () => {
  const out = text(
    await call("design_search", { domain: "styles", query: "glassmorphism", limit: 3 }),
  );
  assert.match(out, /caution: Only over imagery/);
});

test("design_search reports an empty result without erroring", async () => {
  const result = await call("design_search", { domain: "styles", query: "zzqxv plorp" });
  assert.notEqual(result.isError, true);
  assert.match(text(result), /No styles rows match/);
});

test("design_get returns one row in full and errors on an unknown id", async () => {
  const found = text(await call("design_get", { id: "styles:glassmorphism" }));
  assert.match(found, /^# /);
  assert.match(found, /Caution:/);
  const missing = await call("design_get", { id: "styles:does-not-exist" });
  assert.equal(missing.isError, true);
  const badDomain = await call("design_get", { id: "bogus:thing" });
  assert.equal(badDomain.isError, true);
});

test("resolve_library maps a need to the stack's library and warns about hand rolling", async () => {
  const out = text(await call("resolve_library", { need: "modal", stack: "react" }));
  assert.match(out, /shadcn/);
  assert.match(out, /npm view shadcn version/);
  assert.match(out, /northstar\.allow/);
});

test("resolve_library detects the stack from the project and lets next inherit react", async () => {
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { vue: "3.5.0" } }));
  assert.match(text(await call("resolve_library", { need: "toast" })), /vue-sonner/);
  assert.match(
    text(await call("resolve_library", { need: "toast", stack: "next" })),
    /use: Sonner/,
  );
});

test("resolve_library errors on an unknown need and lists the known ones", async () => {
  const result = await call("resolve_library", { need: "hologram" });
  assert.equal(result.isError, true);
  assert.match(text(result), /Known needs:/);
});

test("resolve_font verifies a family and suggests the closest for a typo", async () => {
  assert.match(text(await call("resolve_font", { family: "Inter" })), /^Inter:/);
  const bad = await call("resolve_font", { family: "Intr" });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /Closest:/);
});

test("resolve_font gives next the font loader import", async () => {
  assert.match(
    text(await call("resolve_font", { family: "Inter", stack: "next" })),
    /next\/font\/google/,
  );
});

test("resolve_font searches pairings and families by mood and keeps cautions", async () => {
  const out = text(await call("resolve_font", { mood: "elegant editorial serif" }));
  assert.match(out, /Pairings:/);
  assert.match(out, /Families:/);
  assert.match(out, /@fontsource/);
  const empty = await call("resolve_font", {});
  assert.equal(empty.isError, true);
});

test("resolve_icon names the stack's icon library and a verification command", async () => {
  const out = text(await call("resolve_icon", { names: ["search"], stack: "react" }));
  assert.match(out, /lucide-react/);
  assert.match(out, /verify: node -e/);
});

test("design data loads on the first data tool call, not at the handshake", () => {
  const script = `
    import { Client } from "@modelcontextprotocol/sdk/client/index.js";
    import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
    import { createMcpServer } from "./src/server.ts";
    import { CommentStore } from "./src/store.ts";
    const server = createMcpServer(new CommentStore(process.env.ROOT), undefined, undefined, { root: process.env.ROOT, packs: "all" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(s), client.connect(c)]);
    const listed = (await client.listTools()).tools.some((t) => t.name === "design_search");
    const result = await client.callTool({ name: "design_search", arguments: { domain: "styles", query: "minimal" } });
    console.log(JSON.stringify({ listed, isError: result.isError, text: result.content[0].text }));
    process.exit(0);
  `;
  const out = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      encoding: "utf8",
      env: { ...process.env, ROOT: root, NORTHSTAR_DATA_ROOT: join(root, "missing") },
    },
  );
  const parsed = JSON.parse(out.stdout) as { listed: boolean; isError: boolean; text: string };
  assert.equal(parsed.listed, true, out.stderr);
  assert.equal(parsed.isError, true);
  assert.match(parsed.text, /NORTHSTAR_DATA_ROOT is .*manifest.json/);
});
