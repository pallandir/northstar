import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { captureViewport } = await import("./mcp/src/page/capture.ts");
const { closeBrowser } = await import("./mcp/src/page/browser.ts");
const f = process.argv[2];
const { capture } = await captureViewport(
  pathToFileURL(join(resolve("tests/fixtures/pages"), f)).href,
  process.argv[3] ?? "mobile",
  (s) => ({ crops: [], result: null }),
);
console.log(
  JSON.stringify(
    {
      viewport: capture.snapshot.viewport,
      doc: capture.snapshot.document,
      blocks: capture.snapshot.blocks,
      n: capture.snapshot.nodes.length,
    },
    null,
    1,
  ),
);
console.log(
  capture.snapshot.nodes
    .slice(0, 6)
    .map((n) => [n.kind, n.selector, JSON.stringify(n.box)].join(" "))
    .join("\n"),
);
await closeBrowser();
