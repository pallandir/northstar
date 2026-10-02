import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadCanon } from "../canon/src/index.js";
import { dnaFromSnapshot } from "../mcp/src/design/dna.js";
import { DesignStore } from "../mcp/src/design/store.js";
import { auditSnapshot } from "../mcp/src/page/audit.js";
import { BrowserUnavailable, closeBrowser } from "../mcp/src/page/browser.js";
import { captureViewport } from "../mcp/src/page/capture.js";
import { createDesignServer } from "../mcp/src/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGES = join(HERE, "fixtures", "pages");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let root: string;
let client: Client;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "northstar-design-tools-"));
  const server = createDesignServer(undefined, {
    root,
  });
  const [c, s] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(s), client.connect(c)]);
});

after(async () => {
  rmSync(root, { recursive: true, force: true });
  await closeBrowser();
});

type Result = Awaited<ReturnType<Client["callTool"]>>;
const textOf = (result: Result): string =>
  (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
const call = (name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args });

test("the intent tool says what to set, saves patches and reports what is missing", async () => {
  assert.match(textOf(await call("design_intent")), /No design intent yet/);
  const saved = textOf(
    await call("design_intent", { product: { category: "dev tool" }, audience: ["engineers"] }),
  );
  assert.match(saved, /category: dev tool/);
  assert.match(saved, /Missing: product.surface, personality/);
  const done = textOf(
    await call("design_intent", { product: { surface: "landing" }, personality: ["technical"] }),
  );
  assert.match(done, /Missing: nothing/);
  assert.match(textOf(await call("design_intent")), /audience:\n {2}- engineers/);
});

test("an invalid intent patch is refused with the field named", async () => {
  const result = await call("design_intent", { composition: { density: "huge" } });
  assert.equal(result.isError, true);
});

test("references need exactly one source and a known candidate", async () => {
  const both = await call("references_add", { url: "http://localhost:1", image: "/x.png" });
  assert.equal(both.isError, true);
  assert.match(textOf(both), /exactly one/);
  const none = await call("references_add", {});
  assert.match(textOf(none), /exactly one/);
  const missing = await call("references_add", { candidate: "c9" });
  assert.match(textOf(missing), /There is no candidate c9/);
});

test("an image reference is stored, shown back, recorded and turned into a direction", async () => {
  const file = join(root, "ref.png");
  writeFileSync(file, PNG);
  const added = await call("references_add", { image: file, title: "Editorial landing" });
  assert.notEqual(added.isError, true, textOf(added));
  assert.match(textOf(added), /Added r1 Editorial landing/);
  assert.equal(
    (added.content as Array<{ type: string }>).filter((c) => c.type === "image").length,
    1,
  );

  assert.match(textOf(await call("design_direction")), /No reference contributes/);

  const recorded = await call("references_record", {
    id: "r1",
    dna: {
      typography: { style: "serif", headlineScale: 5 },
      composition: { structure: "asymmetric" },
      characteristics: ["technical"],
    },
    contributes: ["typography", "composition"],
    notes: "huge serif headline, left aligned",
  });
  assert.match(textOf(recorded), /Recorded r1/);
  assert.match(textOf(await call("references_record", { id: "r1" })), /"style":"serif"/);

  const direction = textOf(await call("design_direction"));
  assert.match(direction, /typography from r1/);
  assert.match(direction, /Never copy a reference/);
  assert.ok(existsSync(join(root, ".northstar", "design", "direction.json")));
  assert.deepEqual(new DesignStore(root).readDirection()?.sources.typography, ["r1"]);
});

test("a bad dna value or reference id is refused", async () => {
  assert.equal(
    (await call("references_record", { id: "r1", dna: { geometry: { radius: "huge" } } })).isError,
    true,
  );
  assert.equal((await call("references_record", { id: "r1x" })).isError, true);
  const unknown = await call("references_record", { id: "r7" });
  assert.match(textOf(unknown), /There is no reference r7/);
});

test("search needs an intent or explicit queries and respects the page limit", async () => {
  const tooMany = await call("references_search", {
    queries: ["a b c", "d e f", "g h i", "j k l"],
  });
  assert.equal(tooMany.isError, true);
  assert.match(textOf(tooMany), /limit is 6/);
});

test("a url reference gets its Design DNA measured in Chrome", async (t) => {
  const url = pathToFileURL(join(PAGES, "editorial-clean.html")).href;
  const result = await call("references_add", { url });
  const body = textOf(result);
  if (result.isError && /cannot use this function/.test(body)) return t.skip(body);
  assert.notEqual(result.isError, true, body);
  assert.match(body, /dna measured/);
  const reference = new DesignStore(root).readReference("r2");
  assert.equal(reference.dnaSource, "measured");
  assert.equal(reference.dna.color?.background, "light");
  assert.equal(reference.dna.typography?.style, "serif");
});

async function measure(name: string, viewport: "desktop" | "mobile" = "desktop") {
  const url = pathToFileURL(join(PAGES, `${name}.html`)).href;
  return (await captureViewport(url, viewport, (snapshot) => ({ crops: [], result: snapshot })))
    .result;
}

test("measured DNA tells an editorial page from a generic centred one", async (t) => {
  try {
    const editorial = dnaFromSnapshot(await measure("editorial-clean"));
    const generic = dnaFromSnapshot(await measure("generic-saas"));
    assert.equal(editorial.composition?.structure, "asymmetric");
    assert.equal(generic.composition?.structure, "symmetric");
    assert.equal(editorial.geometry?.radius, "none");
    assert.equal(generic.geometry?.radius, "high");
    assert.equal(editorial.typography?.style, "serif");
    assert.equal(generic.typography?.style, "sans");
    assert.ok((editorial.typography?.headlineScale ?? 0) >= 3);
    assert.ok(editorial.characteristics?.includes("asymmetric"));
    assert.ok(generic.characteristics?.includes("centred"));
  } catch (error) {
    if (error instanceof BrowserUnavailable) return t.skip(error.message);
    throw error;
  }
});

test("a build is flagged when it drifts from the direction and quiet when it matches", async (t) => {
  const canon = loadCanon(join(HERE, "..", "canon"));
  try {
    const snapshot = await measure("editorial-clean");
    const policy = { canon, mode: "persuade" as const, allowed: () => false };
    const drifting = auditSnapshot(snapshot, "desktop", {
      ...policy,
      direction: {
        color: { background: "dark" },
        geometry: { radius: "high" },
        typography: { style: "mono" },
      },
    });
    const finding = drifting.find((f) => f.rule === "NS-PAGE-DRIFT");
    assert.ok(finding, "drift should be reported");
    assert.match(finding?.message ?? "", /background is light, the direction is dark/);
    const matching = auditSnapshot(snapshot, "desktop", {
      ...policy,
      direction: dnaFromSnapshot(snapshot),
    });
    assert.equal(
      matching.find((f) => f.rule === "NS-PAGE-DRIFT"),
      undefined,
    );
    const mobile = await measure("editorial-clean", "mobile");
    assert.deepEqual(
      auditSnapshot(mobile, "mobile", {
        ...policy,
        direction: { color: { background: "dark" } },
      }).filter((f) => f.rule === "NS-PAGE-DRIFT"),
      [],
    );
  } catch (error) {
    if (error instanceof BrowserUnavailable) return t.skip(error.message);
    throw error;
  }
});
