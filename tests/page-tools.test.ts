import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { assertOpenable, closeBrowser } from "../mcp/src/page/browser.js";
import { RunStore } from "../mcp/src/page/runs.js";
import { createMcpServer } from "../mcp/src/server.js";
import { CommentStore } from "../mcp/src/store.js";
import { noopLink } from "./helpers.js";

let root: string;
let client: Client;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "northstar-page-"));
  const server = createMcpServer(new CommentStore(root), noopLink, undefined, {
    root,
    packs: "all",
  });
  const [c, s] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(s), client.connect(c)]);
});

after(() => rmSync(root, { recursive: true, force: true }));

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): string =>
  (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");

test("only http, https and file addresses can be opened", () => {
  assert.equal(assertOpenable("http://localhost:3000/x").hostname, "localhost");
  assert.equal(assertOpenable("file:///tmp/a.html").protocol, "file:");
  assert.throws(() => assertOpenable("chrome://settings"), /cannot be opened/);
  assert.throws(() => assertOpenable("javascript:alert(1)"), /cannot be opened/);
  assert.throws(() => assertOpenable("not a url"), /not a valid URL/);
});

test("the page tools are registered with the page pack", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes("page_capture"));
  assert.ok(names.includes("page_audit"));
});

test("a bad address is an error result that says what to pass, never a crash", async () => {
  const result = await client.callTool({
    name: "page_audit",
    arguments: { url: "chrome://settings" },
  });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /cannot be opened/);
});

const FIXTURE = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pages", "multiple-primary.html"),
).href;

test("page_audit returns ranked findings, a crop image and a saved run", async (t) => {
  const result = await client.callTool({ name: "page_audit", arguments: { url: FIXTURE } });
  const body = textOf(result);
  if (result.isError && /cannot use this function/.test(body)) return t.skip(body);
  assert.notEqual(result.isError, true, body);
  assert.match(body, /NS-PAGE-PRIMARY-ACTIONS/);
  const images = (result.content as Array<{ type: string; mimeType?: string }>).filter(
    (c) => c.type === "image",
  );
  assert.ok(images.length >= 1 && images.length <= 4);
  assert.equal(images[0]?.mimeType, "image/jpeg");
  const store = new RunStore(root);
  const run = store.latest();
  assert.equal(run?.url, FIXTURE);
  assert.ok(run?.findings.some((f) => f.rule === "NS-PAGE-PRIMARY-ACTIONS"));
  assert.ok(existsSync(store.pathOf(run?.id ?? "", "full-desktop.png")));
});

test("page_capture returns one first screen image per viewport", async (t) => {
  const result = await client.callTool({ name: "page_capture", arguments: { url: FIXTURE } });
  const body = textOf(result);
  if (result.isError && /cannot use this function/.test(body)) return t.skip(body);
  assert.notEqual(result.isError, true, body);
  const images = (result.content as Array<{ type: string }>).filter((c) => c.type === "image");
  assert.equal(images.length, 2);
});

after(async () => {
  await closeBrowser();
});

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourcesUnder(path) : path.endsWith(".ts") ? [path] : [];
  });
}

test("playwright-core is only ever imported lazily or as a type", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "..", "mcp", "src");
  const offenders = sourcesUnder(src).filter((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .some((line) => /from "playwright-core"/.test(line) && !/^import type /.test(line)),
  );
  assert.deepEqual(offenders, []);
});
